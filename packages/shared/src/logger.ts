import { createRequire } from "node:module";
import { pino, type Logger } from "pino";

/** Is the pino-pretty transport actually installed? (It's a dev-only dep.) */
function prettyAvailable(): boolean {
  try {
    createRequire(import.meta.url).resolve("pino-pretty");
    return true;
  } catch {
    return false;
  }
}

/**
 * Structured logger. Secrets and PII are redacted so tokens, signature material,
 * and sender details never land in logs. Pretty output in dev (when pino-pretty
 * is present), JSON otherwise — and never crashes if pretty is requested but the
 * transport isn't installed (e.g. a production image).
 */
export function createLogger(opts: { level: string; pretty?: boolean; name?: string }): Logger {
  const usePretty = opts.pretty === true && prettyAvailable();
  return pino({
    ...(opts.name ? { name: opts.name } : {}),
    level: opts.level,
    redact: {
      paths: [
        "req.headers.authorization",
        'req.headers["nomba-signature"]',
        "*.access_token",
        "*.refresh_token",
        "*.client_secret",
        "*.NOMBA_SIGNATURE_KEY",
        "*.JWT_SECRET",
        "*.senderName",
        "*.accountNumber",
      ],
      censor: "[redacted]",
    },
    ...(usePretty
      ? { transport: { target: "pino-pretty", options: { translateTime: "SYS:standard" } } }
      : {}),
  });
}

export type { Logger };
