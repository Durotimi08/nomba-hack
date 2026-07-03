/**
 * In-memory Nomba adapter. Implements the exact `NombaClient` contract without
 * any network, so integration tests run hermetically and local dev is not bound
 * by the sandbox's 2-VA / ₦150 caps. Deterministic VA numbers keep tests stable.
 */
import { createHash } from "node:crypto";
import { koboToNaira, type Kobo } from "@kobo/shared";
import type {
  Bank,
  BankLookupInput,
  BankLookupResult,
  CreateVirtualAccountInput,
  ListTransactionsInput,
  NombaClient,
  NombaTransaction,
  TransferInput,
  TransferResult,
  VirtualAccount,
} from "./types.js";

const DEFAULT_BANKS: Bank[] = [
  { code: "058", name: "Guaranty Trust Bank" },
  { code: "011", name: "First Bank of Nigeria" },
  { code: "033", name: "United Bank for Africa" },
];

export interface MockOptions {
  merchantName?: string;
}

export class MockNombaClient implements NombaClient {
  private readonly accounts = new Map<string, VirtualAccount>(); // by accountRef
  private readonly byNumber = new Map<string, VirtualAccount>();
  private readonly txByAccountNumber = new Map<string, NombaTransaction[]>();
  private readonly txBySession = new Map<string, NombaTransaction>();
  readonly transfers: TransferResult[] = [];
  private readonly merchantName: string;

  constructor(opts: MockOptions = {}) {
    this.merchantName = opts.merchantName ?? "Kobo";
  }

  createVirtualAccount(input: CreateVirtualAccountInput): Promise<VirtualAccount> {
    const existing = this.accounts.get(input.accountRef);
    if (existing) return Promise.resolve(existing); // idempotent on accountRef
    // Derive a stable 10-digit number from the accountRef so it survives process
    // restarts (an in-memory counter would reset and collide with existing rows).
    const digest = createHash("sha256").update(input.accountRef).digest();
    const bankAccountNumber = String((digest.readUInt32BE(0) % 9_000_000_000) + 1_000_000_000);
    const va: VirtualAccount = {
      accountRef: input.accountRef,
      bankAccountNumber,
      bankAccountName: `${this.merchantName}/${input.accountName}`,
      bankName: "Nombank MFB",
      accountHolderId: `holder-${bankAccountNumber}`,
    };
    this.accounts.set(input.accountRef, va);
    this.byNumber.set(bankAccountNumber, va);
    return Promise.resolve(va);
  }

  fetchVirtualAccount(identifier: string): Promise<VirtualAccount | null> {
    return Promise.resolve(this.accounts.get(identifier) ?? this.byNumber.get(identifier) ?? null);
  }

  getBanks(): Promise<Bank[]> {
    return Promise.resolve(DEFAULT_BANKS);
  }

  lookupBank(input: BankLookupInput): Promise<BankLookupResult> {
    return Promise.resolve({ accountNumber: input.accountNumber, accountName: "Mock Account Name" });
  }

  transferToBank(input: TransferInput): Promise<TransferResult> {
    const result: TransferResult = {
      id: `MOCK-TRANSFER-${input.merchantTxRef}`,
      status: "SUCCESS",
      merchantTxRef: input.merchantTxRef,
      fee: 0n,
    };
    this.transfers.push(result);
    return Promise.resolve(result);
  }

  requeryTransaction(sessionId: string): Promise<NombaTransaction | null> {
    return Promise.resolve(this.txBySession.get(sessionId) ?? null);
  }

  listVirtualAccountTransactions(input: ListTransactionsInput): Promise<NombaTransaction[]> {
    return Promise.resolve(this.txByAccountNumber.get(input.virtualAccount) ?? []);
  }

  // ── Test helpers (not part of NombaClient) ────────────────────────────────

  /** Build the raw inbound-payment webhook body a transfer into this VA would produce. */
  buildInboundWebhook(args: {
    accountRef: string;
    grossKobo: Kobo;
    feeKobo?: Kobo;
    sessionId: string;
    requestId?: string;
    senderName?: string;
    userId?: string;
    walletId?: string;
    transactionId?: string;
    time?: string;
  }): Record<string, unknown> {
    const va = this.accounts.get(args.accountRef);
    const tx = {
      aliasAccountNumber: va?.bankAccountNumber ?? "0000000000",
      fee: koboToNaira(args.feeKobo ?? 0n),
      sessionId: args.sessionId,
      type: "vact_transfer",
      transactionId: args.transactionId ?? `MOCK-TX-${args.sessionId}`,
      aliasAccountName: va?.bankAccountName ?? "Kobo/Unknown",
      responseCode: "",
      transactionAmount: koboToNaira(args.grossKobo),
      narration: `Transfer from ${args.senderName ?? "SENDER"}`,
      time: args.time ?? "2026-02-06T10:21:56Z",
      aliasAccountReference: args.accountRef,
      aliasAccountType: "VIRTUAL",
    };
    return {
      event_type: "payment_success",
      requestId: args.requestId ?? `req-${args.sessionId}`,
      data: {
        merchant: { userId: args.userId ?? "user-1", walletId: args.walletId ?? "wallet-1" },
        transaction: tx,
        customer: { senderName: args.senderName ?? "SENDER", bankName: "Opay", bankCode: "305" },
      },
    };
  }

  /** Register a transaction so the backfill poller / requery can find it. */
  seedTransaction(accountNumber: string, tx: NombaTransaction): void {
    const list = this.txByAccountNumber.get(accountNumber) ?? [];
    list.push(tx);
    this.txByAccountNumber.set(accountNumber, list);
    if (tx.sessionId) this.txBySession.set(tx.sessionId, tx);
  }
}
