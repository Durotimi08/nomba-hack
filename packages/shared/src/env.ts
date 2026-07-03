import { z } from "zod";

/**
 * Environment contract. Validated once at process boot; a malformed or missing
 * required secret fails fast and loud rather than surfacing as a runtime error
 * deep in the money path. Never read `process.env` directly elsewhere.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  API_PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  MIGRATE_ON_BOOT: z
    .string()
    .default("false")
    .transform((s) => s === "true" || s === "1"),
  SEED_ON_BOOT: z
    .string()
    .default("false")
    .transform((s) => s === "true" || s === "1"),

  NOMBA_BASE_URL: z.string().url().default("https://sandbox.nomba.com"),
  NOMBA_CLIENT_ID: z.string().min(1),
  NOMBA_CLIENT_SECRET: z.string().min(1),
  NOMBA_ACCOUNT_ID: z.string().uuid(),
  // Optional: when set, VA creation and payouts are scoped to this sub-account
  // (the parent NOMBA_ACCOUNT_ID stays in the accountId header).
  NOMBA_SUB_ACCOUNT_ID: z.string().uuid().optional(),
  NOMBA_SIGNATURE_KEY: z.string().min(1),
  NOMBA_ADAPTER: z.enum(["real", "mock"]).default("mock"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 bytes"),
  JWT_TTL: z.string().default("1h"),

  BACKFILL_CRON: z.string().default("*/5 * * * *"),
  RECONCILE_CONCURRENCY: z.coerce.number().int().positive().default(8),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Parse and validate the environment. In "mock" adapter mode the Nomba secrets
 * may be placeholders, so we relax them to keep local dev and tests frictionless.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
