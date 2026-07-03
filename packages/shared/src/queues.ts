/**
 * BullMQ queue names — shared by the API (producer) and worker (consumer) so the
 * two never drift. BullMQ reserves ':' as an internal key separator, so names use
 * hyphens.
 */
export const RECONCILE_QUEUE = "kobo-reconcile";
export const PAYOUT_QUEUE = "kobo-payout";
export const BACKFILL_QUEUE = "kobo-backfill";
