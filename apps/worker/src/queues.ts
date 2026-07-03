/** Job payloads for the queues. Queue NAMES live in @kobo/shared (single source). */
export { BACKFILL_QUEUE, PAYOUT_QUEUE, RECONCILE_QUEUE } from "@kobo/shared";

export interface ReconcileJob {
  rawEventId: string;
}

export interface PayoutJob {
  refundId: string;
}

/** A single repeatable backfill job carries no data. */
export type BackfillJob = Record<string, never>;
