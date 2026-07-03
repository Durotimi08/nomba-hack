/**
 * Worker runtime bootstrap: validated env, DB handle, Redis connection, and the
 * configured Nomba client. BullMQ requires `maxRetriesPerRequest: null` on its
 * Redis connection, so we build one connection tuned for it and reuse it for the
 * token lease too.
 */
import { createDb, type DbHandle } from "@kobo/db";
import { createNombaClient, type NombaClient } from "@kobo/nomba";
import { createLogger, loadEnv, type Env, type Logger } from "@kobo/shared";
import { Redis } from "ioredis";

export interface Runtime {
  env: Env;
  log: Logger;
  dbHandle: DbHandle;
  redis: Redis;
  nomba: NombaClient;
}

export function createRuntime(): Runtime {
  const env = loadEnv();
  const log = createLogger({
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV === "development",
    name: "worker",
  });
  const dbHandle = createDb(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const nomba = createNombaClient({
    adapter: env.NOMBA_ADAPTER,
    baseUrl: env.NOMBA_BASE_URL,
    accountId: env.NOMBA_ACCOUNT_ID,
    clientId: env.NOMBA_CLIENT_ID,
    clientSecret: env.NOMBA_CLIENT_SECRET,
    redis,
    ...(env.NOMBA_SUB_ACCOUNT_ID ? { subAccountId: env.NOMBA_SUB_ACCOUNT_ID } : {}),
  });
  return { env, log, dbHandle, redis, nomba };
}

export async function shutdownRuntime(rt: Runtime): Promise<void> {
  await rt.dbHandle.close();
  rt.redis.disconnect();
}
