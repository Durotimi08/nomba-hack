/**
 * Worker entrypoint. Runs three BullMQ consumers against one Redis connection:
 *   - reconcile: processes inbound payment raw_events (concurrency-safe via the
 *     FOR UPDATE invoice lock, so we scale horizontally without group locks),
 *   - payout: pays approved refunds,
 *   - backfill: a repeatable cron job that sweeps the Transactions API.
 */
import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { pollBackfill } from "./backfill.js";
import { processApprovedRefund } from "./payout.js";
import { processRawEvent } from "./reconcile-runner.js";
import { sweepUnprocessed } from "./sweeper.js";
import {
  BACKFILL_QUEUE,
  PAYOUT_QUEUE,
  RECONCILE_QUEUE,
  type PayoutJob,
  type ReconcileJob,
} from "./queues.js";
import { createRuntime, shutdownRuntime } from "./runtime.js";

async function main(): Promise<void> {
  const rt = createRuntime();
  const { env, log, dbHandle, redis, nomba } = rt;
  const db = dbHandle.db;
  // BullMQ accepts an existing ioredis instance at runtime; the cast bridges the
  // structural mismatch between BullMQ's bundled ioredis types and ours.
  const connection = redis as unknown as ConnectionOptions;

  // Producer used by the repeatable backfill job to enqueue reconcile work.
  const reconcileQueue = new Queue<ReconcileJob>(RECONCILE_QUEUE, { connection });
  const enqueueReconcile = async (rawEventId: string): Promise<void> => {
    await reconcileQueue.add("reconcile", { rawEventId }, { jobId: rawEventId });
  };

  const reconcileWorker = new Worker<ReconcileJob>(
    RECONCILE_QUEUE,
    async (job) => {
      const outcome = await processRawEvent(db, job.data.rawEventId);
      log.info({ jobId: job.id, ...outcome }, "reconcile job done");
      return outcome;
    },
    { connection, concurrency: env.RECONCILE_CONCURRENCY },
  );

  const payoutWorker = new Worker<PayoutJob>(
    PAYOUT_QUEUE,
    async (job) => processApprovedRefund({ db, nomba, merchantName: "Kobo", log }, job.data.refundId),
    { connection, concurrency: 2 },
  );

  const backfillWorker = new Worker(
    BACKFILL_QUEUE,
    async () => {
      // The repeatable sweep both backfills missed webhooks and re-enqueues any
      // raw_event that was persisted but failed to enqueue (Redis blip).
      const [backfill, swept] = await Promise.all([
        pollBackfill({ db, nomba, enqueue: enqueueReconcile, log }),
        sweepUnprocessed({ db, enqueue: enqueueReconcile, log }),
      ]);
      return { ...backfill, swept: swept.enqueued };
    },
    { connection, concurrency: 1 },
  );

  // Schedule the repeatable backfill sweep.
  const backfillQueue = new Queue(BACKFILL_QUEUE, { connection });
  await backfillQueue.add("sweep", {}, { repeat: { pattern: env.BACKFILL_CRON }, jobId: "backfill-sweep" });

  for (const w of [reconcileWorker, payoutWorker, backfillWorker]) {
    w.on("failed", (job, err) => log.error({ jobId: job?.id, err: err.message }, "job failed"));
  }
  log.info({ concurrency: env.RECONCILE_CONCURRENCY, cron: env.BACKFILL_CRON }, "worker started");

  const shutdown = async (): Promise<void> => {
    log.info("worker shutting down");
    await Promise.allSettled([
      reconcileWorker.close(),
      payoutWorker.close(),
      backfillWorker.close(),
      reconcileQueue.close(),
      backfillQueue.close(),
    ]);
    await shutdownRuntime(rt);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

void main();
