/**
 * API runtime bootstrap: validated env, DB handle, Redis (for BullMQ producers
 * and the Nomba token lease), the configured Nomba client, and the queue handles
 * the API produces onto (reconcile, payout).
 */
import { Queue, type ConnectionOptions } from "bullmq";
import { createDb, type DbHandle } from "@kobo/db";
import { createNombaClient, type NombaClient } from "@kobo/nomba";
import {
  PAYOUT_QUEUE,
  RECONCILE_QUEUE,
  createLogger,
  loadEnv,
  type Env,
  type Logger,
} from "@kobo/shared";
import { Redis } from "ioredis";

export interface ApiRuntime {
  env: Env;
  log: Logger;
  dbHandle: DbHandle;
  redis: Redis;
  nomba: NombaClient;
  reconcileQueue: Queue<{ rawEventId: string }>;
  payoutQueue: Queue<{ refundId: string }>;
}

export function createApiRuntime(): ApiRuntime {
  const env = loadEnv();
  const log = createLogger({
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV === "development",
    name: "api",
  });
  const dbHandle = createDb(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const connection = redis as unknown as ConnectionOptions;
  const nomba = createNombaClient({
    adapter: env.NOMBA_ADAPTER,
    baseUrl: env.NOMBA_BASE_URL,
    accountId: env.NOMBA_ACCOUNT_ID,
    clientId: env.NOMBA_CLIENT_ID,
    clientSecret: env.NOMBA_CLIENT_SECRET,
    redis,
    ...(env.NOMBA_SUB_ACCOUNT_ID ? { subAccountId: env.NOMBA_SUB_ACCOUNT_ID } : {}),
  });
  return {
    env,
    log,
    dbHandle,
    redis,
    nomba,
    reconcileQueue: new Queue(RECONCILE_QUEUE, { connection }),
    payoutQueue: new Queue(PAYOUT_QUEUE, { connection }),
  };
}

export async function closeApiRuntime(rt: ApiRuntime): Promise<void> {
  await Promise.allSettled([rt.reconcileQueue.close(), rt.payoutQueue.close()]);
  await rt.dbHandle.close();
  rt.redis.disconnect();
}
