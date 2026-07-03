/** API entrypoint: bootstrap the runtime, build the app, listen, handle shutdown. */
import { runMigrations, runSeed } from "@kobo/db";
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

  const shutdown = async (): Promise<void> => {
    await app.close();
    await closeApiRuntime(rt);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

void main();
