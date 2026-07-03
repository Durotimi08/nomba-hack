/** API entrypoint: bootstrap the runtime, build the app, listen, handle shutdown. */
import { runMigrations, runSeed } from "@kobo/db";
import { startWorkers, type WorkerHandle } from "@kobo/worker";
import { buildApp } from "./app.js";
import { closeApiRuntime, createApiRuntime } from "./runtime.js";

async function main(): Promise<void> {
  const rt = createApiRuntime();

  if (rt.env.SEED_ON_BOOT) {
    rt.log.info("SEED_ON_BOOT: applying migrations and seeding demo data");
    await runSeed(rt.env.DATABASE_URL);
  } else if (rt.env.MIGRATE_ON_BOOT) {
    const applied = await runMigrations(rt.env.DATABASE_URL);
    rt.log.info(
      { applied },
      applied.length ? `applied ${applied.length} migration(s)` : "schema up to date",
    );
  }

  const app = buildApp(rt);

  await app.listen({ host: "0.0.0.0", port: rt.env.API_PORT });

  // Zero-cost deploys: run the reconcile/payout/backfill consumers in this same
  // process so a single free instance both serves HTTP and drains the queues.
  // The API runtime already exposes db/redis/nomba, so startWorkers reuses them.
  let workers: WorkerHandle | undefined;
  if (rt.env.RUN_WORKER_IN_PROCESS) {
    rt.log.info("RUN_WORKER_IN_PROCESS: starting in-process job consumers");
    workers = await startWorkers(rt);
  }

  const shutdown = async (): Promise<void> => {
    await app.close();
    if (workers) await workers.close();
    await closeApiRuntime(rt);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

void main();
