/**
 * Real Nomba HTTP adapter. Connection-pooled via undici, authenticated through
 * the Redis-leased token manager, with bounded exponential-backoff retries on
 * transient failures (5xx / 429 / network). Write calls are safe to retry
 * because every mutation carries an idempotency key (accountRef / merchantTxRef)
 * that Nomba dedupes server-side.
 */
import { nairaToKobo, type Kobo } from "@kobo/shared";
import type { Redis } from "ioredis";
import pRetry, { AbortError } from "p-retry";
import { request } from "undici";
import { NombaTokenManager } from "./token.js";
import {
  NombaApiError,
  type Bank,
  type BankLookupInput,
  type BankLookupResult,
  type CreateVirtualAccountInput,
  type ListTransactionsInput,
  type NombaClient,
  type NombaTransaction,
  type TransferInput,
  type TransferResult,
  type TransferStatus,
  type VirtualAccount,
} from "./types.js";

interface Envelope<T> {
  code: string;
  description: string;
  data: T | null;
}

interface RealConfig {
  baseUrl: string;
  accountId: string;
  clientId: string;
  clientSecret: string;
  /** When set, VA creation and payouts are scoped to this sub-account. */
  subAccountId?: string;
  redis: Redis;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export class RealNombaClient implements NombaClient {
  private readonly tokens: NombaTokenManager;

  constructor(private readonly cfg: RealConfig) {
    this.tokens = new NombaTokenManager({
      redis: cfg.redis,
      baseUrl: cfg.baseUrl,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      accountId: cfg.accountId,
    });
  }

  async createVirtualAccount(input: CreateVirtualAccountInput): Promise<VirtualAccount> {
    const path = this.cfg.subAccountId
      ? `/v1/accounts/virtual/${this.cfg.subAccountId}`
      : "/v1/accounts/virtual";
    const data = await this.call<RawVirtualAccount>("POST", path, {
      body: { accountRef: input.accountRef, accountName: input.accountName, currency: "NGN" },
    });
    if (!data) {
      throw new NombaApiError("Empty create-VA response", 502, undefined, "accounts/virtual");
    }
    return mapVirtualAccount(data);
  }

  async fetchVirtualAccount(identifier: string): Promise<VirtualAccount | null> {
    const data = await this.call<RawVirtualAccount>(
      "GET",
      `/v1/accounts/virtual/${encodeURIComponent(identifier)}`,
      { allow404: true },
    );
    return data ? mapVirtualAccount(data) : null;
  }

  async getBanks(): Promise<Bank[]> {
    const data = await this.call<{ results: Bank[] }>("GET", "/v1/transfers/banks", {});
    return data?.results ?? [];
  }

  async lookupBank(input: BankLookupInput): Promise<BankLookupResult> {
    const data = await this.call<BankLookupResult>("POST", "/v1/transfers/bank/lookup", {
      body: { accountNumber: input.accountNumber, bankCode: input.bankCode },
    });
    if (!data) throw new NombaApiError("Empty lookup response", 502, undefined, "bank/lookup");
    return data;
  }

  async transferToBank(input: TransferInput): Promise<TransferResult> {
    const path = this.cfg.subAccountId
      ? `/v2/transfers/bank/${this.cfg.subAccountId}`
      : "/v2/transfers/bank";
    const data = await this.call<RawTransfer>("POST", path, {
      // Envelope code is "200"/"201" here (not "00"); a 201 = PROCESSING is valid.
      successCodes: ["00", "200", "201"],
      body: {
        amount: Number(input.amount),
        accountNumber: input.accountNumber,
        accountName: input.accountName,
        bankCode: input.bankCode,
        merchantTxRef: input.merchantTxRef,
        senderName: input.senderName,
        ...(input.narration ? { narration: input.narration } : {}),
      },
    });
    return {
      id: data?.id ?? input.merchantTxRef,
      status: (data?.status ?? "PROCESSING") as TransferStatus,
      merchantTxRef: input.merchantTxRef,
      fee: data?.fee != null && Number.isFinite(data.fee) ? BigInt(Math.round(data.fee)) : null,
    };
  }

  async requeryTransaction(sessionId: string): Promise<NombaTransaction | null> {
    const data = await this.call<RawTransaction>(
      "GET",
      `/v1/transactions/requery/${encodeURIComponent(sessionId)}`,
      { allow404: true },
    );
    return data ? mapTransaction(data) : null;
  }

  async listVirtualAccountTransactions(input: ListTransactionsInput): Promise<NombaTransaction[]> {
    const out: NombaTransaction[] = [];
    let cursor: string | undefined;
    do {
      const qs = new URLSearchParams({ virtual_account: input.virtualAccount, limit: "50" });
      if (input.dateFrom) qs.set("dateFrom", input.dateFrom);
      if (input.dateTo) qs.set("dateTo", input.dateTo);
      if (cursor) qs.set("cursor", cursor);
      // Tolerate 404: a VA with no Nomba-side transactions (or a not-yet-confirmed
      // list endpoint) should read as "nothing to backfill", not crash the sweep.
      const data = await this.call<{ results: RawTransaction[]; cursor?: string }>(
        "GET",
        `/v1/transactions/virtual?${qs.toString()}`,
        { allow404: true },
      );
      for (const t of data?.results ?? []) out.push(mapTransaction(t));
      cursor = data?.cursor && data.cursor.length > 0 ? data.cursor : undefined;
    } while (cursor);
    return out;
  }

  /** Single authenticated, retrying, envelope-unwrapping request. */
  private async call<T>(
    method: "GET" | "POST",
    path: string,
    opts: { body?: unknown; allow404?: boolean; successCodes?: string[] },
  ): Promise<T | null> {
    const successCodes = opts.successCodes ?? ["00"];
    return pRetry(
      async () => {
        const token = await this.tokens.getAccessToken();
        const res = await request(`${this.cfg.baseUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            accountId: this.cfg.accountId,
            ...(opts.body ? { "content-type": "application/json" } : {}),
          },
          ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
        });

        if (opts.allow404 && res.statusCode === 404) {
          await res.body.dump(); // drain the body so the socket can be reused
          return null;
        }
        const json = (await res.body.json()) as Envelope<T>;
        if (res.statusCode >= 300 || !successCodes.includes(json.code)) {
          const err = new NombaApiError(
            `${json.code} ${json.description}`,
            res.statusCode,
            json.code,
            path,
          );
          // Only retry transient failures; 4xx (validation/auth) fail fast.
          if (!RETRYABLE_STATUS.has(res.statusCode)) throw new AbortError(err);
          throw err;
        }
        return json.data;
      },
      { retries: 3, minTimeout: 200, factor: 2 },
    );
  }
}

// ── Raw → domain mappers for inbound reads (naira → kobo at the boundary) ───
interface RawVirtualAccount {
  accountRef: string;
  bankAccountNumber: string;
  bankAccountName: string;
  bankName: string;
  accountHolderId?: string;
}
function mapVirtualAccount(d: RawVirtualAccount): VirtualAccount {
  return {
    accountRef: d.accountRef,
    bankAccountNumber: d.bankAccountNumber,
    bankAccountName: d.bankAccountName,
    bankName: d.bankName,
    accountHolderId: d.accountHolderId ?? null,
  };
}

interface RawTransfer {
  id?: string;
  status?: string;
  fee?: number;
}

interface RawTransaction {
  sessionId?: string;
  transactionAmount?: number;
  amount?: number;
  fee?: number;
  type?: string;
  status?: string;
  aliasAccountReference?: string;
  aliasAccountNumber?: string;
  time?: string;
  timeCreated?: string;
  meta?: { fee?: number; transactionAmount?: number; transactionId?: string };
}
function num(...vals: Array<number | undefined>): Kobo {
  const v = vals.find((x) => typeof x === "number");
  return v === undefined ? 0n : nairaToKobo(v);
}
function mapTransaction(t: RawTransaction): NombaTransaction {
  return {
    sessionId: t.sessionId ?? t.meta?.transactionId ?? null,
    amount: num(t.transactionAmount, t.meta?.transactionAmount, t.amount),
    fee: num(t.fee, t.meta?.fee),
    type: t.type ?? null,
    status: t.status ?? null,
    aliasAccountReference: t.aliasAccountReference ?? null,
    aliasAccountNumber: t.aliasAccountNumber ?? null,
    occurredAt: t.time ?? t.timeCreated ?? null,
  };
}
