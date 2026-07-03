import { z } from "zod";

/**
 * Zod schemas for the Nomba webhook payload. Schemas are lenient with
 * unknown fields (`.passthrough()`) because Nomba may add keys, but strict on
 * the fields we reconcile against. Amounts are kept as raw naira numbers here;
 * the naira→kobo conversion happens in the normaliser at the integration
 * boundary (`@kobo/nomba`), never in transit.
 */

export const WEBHOOK_EVENT_TYPES = [
  "payment_success",
  "payment_failed",
  "payment_reversal",
  "payout_success",
  "payout_failed",
  "payout_refund",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

const MerchantSchema = z
  .object({
    userId: z.string().optional(),
    walletId: z.string().optional(),
    walletBalance: z.number().optional(),
  })
  .passthrough();

const CustomerSchema = z
  .object({
    senderName: z.string().optional(),
    bankName: z.string().optional(),
    bankCode: z.string().optional(),
    accountNumber: z.string().optional(),
  })
  .passthrough();

const TransactionSchema = z
  .object({
    sessionId: z.string().min(1),
    transactionId: z.string().optional(),
    type: z.string(), // e.g. "vact_transfer"
    aliasAccountType: z.string().optional(), // "VIRTUAL"
    aliasAccountReference: z.string().optional(), // = our accountRef (primary match)
    aliasAccountNumber: z.string().optional(), // the VA number (fallback match)
    aliasAccountName: z.string().optional(),
    transactionAmount: z.number().nonnegative(), // naira (major units)
    fee: z.number().nonnegative().default(0), // naira (major units)
    narration: z.string().optional(),
    responseCode: z.string().optional(),
    time: z.string().optional(),
  })
  .passthrough();

/** Generic envelope — event_type drives downstream routing. */
export const WebhookEnvelopeSchema = z
  .object({
    event_type: z.string(),
    requestId: z.string().optional(),
    data: z
      .object({
        merchant: MerchantSchema.optional(),
        customer: CustomerSchema.optional(),
        transaction: TransactionSchema.partial().passthrough().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type WebhookEnvelope = z.infer<typeof WebhookEnvelopeSchema>;

/** Strict schema for the inbound VA-credit event we actually reconcile. */
export const InboundPaymentSchema = z
  .object({
    event_type: z.literal("payment_success"),
    requestId: z.string().optional(),
    data: z.object({
      merchant: MerchantSchema.optional(),
      customer: CustomerSchema.optional(),
      transaction: TransactionSchema,
    }),
  })
  .passthrough();
export type InboundPayment = z.infer<typeof InboundPaymentSchema>;

/** Is this envelope an inbound virtual-account credit we should reconcile? */
export function isInboundVirtualAccountCredit(env: WebhookEnvelope): boolean {
  return (
    env.event_type === "payment_success" &&
    env.data.transaction?.type === "vact_transfer" &&
    env.data.transaction?.aliasAccountType === "VIRTUAL"
  );
}
