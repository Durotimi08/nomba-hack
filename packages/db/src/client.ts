import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { schema } from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close: () => Promise<void>;
}

/**
 * Build a Drizzle client over a pooled pg connection.
 *
 * `bigint` columns are returned as JS BigInt by drizzle's `mode: "bigint"`, but
 * node-postgres parses INT8 to a string by default — register a global parser so
 * raw queries and aggregates also yield BigInt, keeping the money path integer-only.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (val) => BigInt(val));

export function createDb(connectionString: string, max = 10): DbHandle {
  const pool = new pg.Pool({ connectionString, max });
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    close: () => pool.end(),
  };
}
