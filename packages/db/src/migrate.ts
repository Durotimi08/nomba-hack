/**
 * Minimal, transparent SQL migrator.
 *
 * Applies every `migrations/*.sql` file in lexical order, each inside its own
 * transaction, recording applied files in `_kobo_migrations`. We hand-author the
 * DDL (rather than generate it) because the ledger's correctness rests on exact
 * CHECK constraints, partial indexes, and append-only triggers that must be
 * reviewable. Idempotent: re-running applies only new files.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function runMigrations(connectionString: string): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _kobo_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    const done = new Set(
      (await client.query<{ id: string }>("SELECT id FROM _kobo_migrations")).rows.map(
        (r) => r.id,
      ),
    );

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _kobo_migrations (id) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }
    return applied;
  } finally {
    await client.end();
  }
}

// Executed directly via `pnpm --filter @kobo/db migrate`.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required to run migrations");
  runMigrations(url)
    .then((applied) => {
      console.log(applied.length ? `Applied: ${applied.join(", ")}` : "No new migrations.");
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
