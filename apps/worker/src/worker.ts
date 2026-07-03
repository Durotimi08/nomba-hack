/**
 * Worker consumers. Runs three BullMQ consumers against one Redis connection:
 *   - reconcile: processes inbound payment raw_events (concurrency-safe via the
 *     FOR UPDATE invoice lock, so we scale horizontally without group locks),
 *   - payout: pays approved refunds,
 *   - backfill: a repeatable cron job that sweeps the Transactions API.
 *
 * `startWorkers` is exported so the same consumers can run either as a dedicated
 * process (this file's `main`, e.g. a paid Render background worker) OR in-process
 * alongside the API on a single free instance (see RUN_WORKER_IN_PROCESS in the
 * API server). It returns a `close()` for graceful shutdown.
 */
import { fileURLToPath } from "node:url";
import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { DbHandle } from "@kobo/db";
import type { NombaClient } from "@kobo/nomba";
import type { Env, Logger } from "@kobo/shared";
import type { Redis } from "ioredis";
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

/** Everything the consumers need — satisfied by both the worker and API runtimes. */
export interface WorkerDeps {
  env: Env;
  log: Logger;
  dbHandle: DbHandle;
  redis: Redis;
  nomba: NombaClient;
}

export interface WorkerHandle {
  close: () => Promise<void>;
}

/** Start the reconcile/payout/backfill consumers. Idempotent per Redis (the
 *  repeatable job uses a fixed jobId), so safe to run on one instance. */
export async function startWorkers(deps: WorkerDeps): Promise<WorkerHandle> {
  const { env, log, dbHandle, redis, nomba } = deps;
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
  log.info({ concurrency: env.RECONCILE_CONCURRENCY, cron: env.BACKFILL_CRON }, "workers started");

  return {
    close: async () => {
      await Promise.allSettled([
        reconcileWorker.close(),
        payoutWorker.close(),
        backfillWorker.close(),
        reconcileQueue.close(),
        backfillQueue.close(),
      ]);
    },
  };
}

/** Standalone entrypoint: own runtime + signal handling. */
async function main(): Promise<void> {
  const rt = createRuntime();
  const workers = await startWorkers(rt);

  const shutdown = async (): Promise<void> => {
    rt.log.info("worker shutting down");
    await workers.close();
    await shutdownRuntime(rt);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

// Only self-run when executed directly (node dist/worker.js), not when imported
// in-process by the API.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) void main();
