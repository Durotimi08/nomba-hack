/**
 * Enqueue-failure sweeper. "Persist-before-enqueue" means a raw_event is durable
 * even if the enqueue to Redis fails (Redis blip) — but then nothing processes it.
 * This sweep re-enqueues any valid, unprocessed raw_event older than a grace
 * window (so it doesn't race events still being handled). Idempotent: the
 * reconcile job's BullMQ jobId is the rawEventId, and the session gate dedupes.
 */
import { rawEvents, type Db } from "@kobo/db";
import type { Logger } from "@kobo/shared";
import { and, eq, isNull, lt } from "drizzle-orm";

export interface SweepDeps {
  db: Db;
  enqueue: (rawEventId: string) => Promise<void>;
  graceMs?: number;
  log?: Logger;
}

export async function sweepUnprocessed(deps: SweepDeps): Promise<{ enqueued: number }> {
  const { db, enqueue, log } = deps;
  const cutoff = new Date(Date.now() - (deps.graceMs ?? 60_000));

  const stuck = await db
    .select({ id: rawEvents.id })
    .from(rawEvents)
    .where(
      and(
        isNull(rawEvents.processedAt),
        eq(rawEvents.signatureValid, true),
        lt(rawEvents.receivedAt, cutoff),
      ),
    )
    .limit(500);

  for (const e of stuck) await enqueue(e.id);
  if (stuck.length > 0) log?.warn({ enqueued: stuck.length }, "sweeper re-enqueued stuck raw_events");
  return { enqueued: stuck.length };
}
