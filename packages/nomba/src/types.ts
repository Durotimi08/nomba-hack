/**
 * The Nomba client interface. Both the real HTTP adapter and the in-memory mock
 * implement this, so the engine, worker, and tests depend only on the contract —
 * never on whether we are hitting sandbox or running hermetically. Amounts that
 * cross this boundary are kobo (`bigint`); the adapters convert to/from Nomba's
 * naira at the wire.
 */
import type { Kobo } from "@kobo/shared";

export interface CreateVirtualAccountInput {
  /** Caller-supplied unique key, 16–64 chars (= our customer accountRef). */
  accountRef: string;
  /** 8–64 chars. */
  accountName: string;
}

export interface VirtualAccount {
  accountRef: string;
  bankAccountNumber: string;
  bankAccountName: string; // "<merchant>/<customer>"
  bankName: string;
  accountHolderId: string | null;
}

export interface Bank {
  code: string;
  name: string;
}

export interface BankLookupInput {
  accountNumber: string;
  bankCode: string;
}

export interface BankLookupResult {
  accountNumber: string;
  accountName: string;
}

export interface TransferInput {
  /** Payout amount in kobo; sent to Nomba as kobo (minor units) on the wire. */
  amount: Kobo;
  accountNumber: string;
  accountName: string;
  bankCode: string;
  /** Idempotency key — unique per transaction, reused (never regenerated) while pending. */
  merchantTxRef: string;
  senderName: string;
  narration?: string;
}

export type TransferStatus =
  | "SUCCESS"
  | "PENDING_BILLING"
  | "PROCESSING"
  | "NEW"
  | "REFUND"
  | "FAILED";

export interface TransferResult {
  id: string;
  status: TransferStatus;
  merchantTxRef: string;
  /** Fee in kobo, if Nomba reported one. */
  fee: Kobo | null;
}

/** A transaction returned by the requery/backfill endpoints (already kobo-normalised). */
export interface NombaTransaction {
  sessionId: string | null;
  amount: Kobo;
  fee: Kobo;
  type: string | null;
  status: string | null;
  aliasAccountReference: string | null;
  aliasAccountNumber: string | null;
  occurredAt: string | null;
}

export interface ListTransactionsInput {
  virtualAccount: string;
  /** Date-only `YYYY-MM-DD` per the VA-transactions endpoint. */
  dateFrom?: string;
  dateTo?: string;
}

export interface NombaClient {
  createVirtualAccount(input: CreateVirtualAccountInput): Promise<VirtualAccount>;
  fetchVirtualAccount(identifier: string): Promise<VirtualAccount | null>;
  getBanks(): Promise<Bank[]>;
  lookupBank(input: BankLookupInput): Promise<BankLookupResult>;
  transferToBank(input: TransferInput): Promise<TransferResult>;
  requeryTransaction(sessionId: string): Promise<NombaTransaction | null>;
  listVirtualAccountTransactions(input: ListTransactionsInput): Promise<NombaTransaction[]>;
}

/** Raised when Nomba returns a non-success envelope or an HTTP error. */
export class NombaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
    readonly endpoint: string,
  ) {
    super(message);
    this.name = "NombaApiError";
  }
}
