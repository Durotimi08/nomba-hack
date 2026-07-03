import type { Redis } from "ioredis";
import { MockNombaClient } from "./mock.js";
import { RealNombaClient } from "./real.js";
import type { NombaClient } from "./types.js";

export interface NombaClientConfig {
  adapter: "real" | "mock";
  baseUrl: string;
  accountId: string;
  clientId: string;
  clientSecret: string;
  /** Optional sub-account to scope VA creation + payouts to. */
  subAccountId?: string;
  /** Required for the real adapter (token lease); ignored by the mock. */
  redis?: Redis;
}

/** Build the configured Nomba client. The real adapter needs a Redis handle. */
export function createNombaClient(cfg: NombaClientConfig): NombaClient {
  if (cfg.adapter === "mock") return new MockNombaClient();
  if (!cfg.redis) throw new Error("Real Nomba adapter requires a Redis connection for the token lease");
  return new RealNombaClient({
    baseUrl: cfg.baseUrl,
    accountId: cfg.accountId,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    redis: cfg.redis,
    ...(cfg.subAccountId ? { subAccountId: cfg.subAccountId } : {}),
  });
}
