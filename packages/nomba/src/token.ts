/**
 * Nomba OAuth token manager with a Redis lease.
 *
 * Many api/worker replicas share one Nomba credential. If each refreshed
 * independently they would stampede `/auth/token/issue` and invalidate each
 * other. So the token is cached in Redis and only ONE instance refreshes at a
 * time, guarded by a Redis `SET NX` lease (cross-process) plus an in-process
 * mutex (same-process). Tokens are refreshed ~5 min before `expiresAt`.
 */
import { Mutex } from "async-mutex";
import type { Redis } from "ioredis";
import { request } from "undici";

const TOKEN_KEY = "kobo:nomba:token";
const LOCK_KEY = "kobo:nomba:token:lock";
const LOCK_TTL_MS = 10_000;
const REFRESH_SKEW_MS = 5 * 60_000;

interface CachedToken {
  access_token: string;
  refresh_token: string;
  expiresAtMs: number;
}

interface TokenManagerConfig {
  redis: Redis;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  accountId: string;
}

interface AuthResponse {
  code: string;
  description: string;
  data?: { access_token: string; refresh_token: string; expiresAt: string };
}

export class NombaTokenManager {
  private readonly mutex = new Mutex();

  constructor(private readonly cfg: TokenManagerConfig) {}

  async getAccessToken(): Promise<string> {
    const cached = await this.read();
    if (cached && !this.nearExpiry(cached)) return cached.access_token;

    return this.mutex.runExclusive(async () => {
      const again = await this.read();
      if (again && !this.nearExpiry(again)) return again.access_token;

      const holdsLease = await this.acquireLease();
      if (!holdsLease) {
        const fresh = await this.waitForPeerRefresh();
        if (fresh) return fresh.access_token;
      }
      try {
        const token = await this.refreshOrIssue(again ?? cached ?? null);
        await this.write(token);
        return token.access_token;
      } finally {
        if (holdsLease) await this.cfg.redis.del(LOCK_KEY);
      }
    });
  }

  private nearExpiry(t: CachedToken): boolean {
    return Date.now() >= t.expiresAtMs - REFRESH_SKEW_MS;
  }

  private async read(): Promise<CachedToken | null> {
    const raw = await this.cfg.redis.get(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as CachedToken) : null;
  }

  private async write(t: CachedToken): Promise<void> {
    await this.cfg.redis.set(TOKEN_KEY, JSON.stringify(t));
  }

  private async acquireLease(): Promise<boolean> {
    const res = await this.cfg.redis.set(LOCK_KEY, "1", "PX", LOCK_TTL_MS, "NX");
    return res === "OK";
  }

  /** Poll briefly for a peer that holds the lease to publish a fresh token. */
  private async waitForPeerRefresh(): Promise<CachedToken | null> {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const t = await this.read();
      if (t && !this.nearExpiry(t)) return t;
    }
    return null;
  }

  private async refreshOrIssue(current: CachedToken | null): Promise<CachedToken> {
    if (current?.refresh_token) {
      try {
        return await this.callAuth(
          "/v1/auth/token/refresh",
          { grant_type: "refresh_token", refresh_token: current.refresh_token },
          current.access_token,
        );
      } catch {
        // Refresh token expired/invalid — fall back to a fresh issue.
      }
    }
    return this.callAuth("/v1/auth/token/issue", {
      grant_type: "client_credentials",
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
    });
  }

  private async callAuth(
    path: string,
    body: Record<string, string>,
    bearer?: string,
  ): Promise<CachedToken> {
    const res = await request(`${this.cfg.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accountId: this.cfg.accountId,
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const json = (await res.body.json()) as AuthResponse;
    if (res.statusCode >= 300 || json.code !== "00" || !json.data) {
      throw new Error(`Nomba auth failed (${path}): ${json.code} ${json.description}`);
    }
    return {
      access_token: json.data.access_token,
      refresh_token: json.data.refresh_token,
      expiresAtMs: new Date(json.data.expiresAt).getTime(),
    };
  }
}
