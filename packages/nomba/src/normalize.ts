/**
 * Boundary normalisation: turn a raw Nomba inbound-payment webhook into the
 * internal kobo-integer shape the reconciliation pipeline consumes. This is the
 * ONE place naira→kobo conversion happens on the way in.
 */
import { nairaToKobo, type InboundPayment, type Kobo } from "@kobo/shared";

export interface NormalizedInboundPayment {
  sessionId: string;
  requestId: string | null;
  /** = our customer accountRef (primary match key). */
  accountRef: string | null;
  /** The VA number credited (fallback match key). */
  virtualAccountNumber: string | null;
  gross: Kobo;
  fee: Kobo;
  senderName: string | null;
  senderBank: string | null;
  senderAccountNumber: string | null;
  senderBankCode: string | null;
  occurredAt: string | null;
}

export function normalizeInboundPayment(event: InboundPayment): NormalizedInboundPayment {
  const tx = event.data.transaction;
  const customer = event.data.customer;
  return {
    sessionId: tx.sessionId,
    requestId: event.requestId ?? null,
    accountRef: tx.aliasAccountReference ?? null,
    virtualAccountNumber: tx.aliasAccountNumber ?? null,
    gross: nairaToKobo(tx.transactionAmount),
    fee: nairaToKobo(tx.fee),
    senderName: customer?.senderName ?? null,
    senderBank: customer?.bankName ?? null,
    senderAccountNumber: customer?.accountNumber ?? null,
    senderBankCode: customer?.bankCode ?? null,
    occurredAt: tx.time ?? null,
  };
}
