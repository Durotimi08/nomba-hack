/**
 * Nomba webhook signature verification.
 *
 * Nomba does NOT HMAC the raw body for this scheme. It HMAC-SHA256s a
 * colon-delimited string of 9 fields (base64-encoded) and the
 * comparison is case-INSENSITIVE. We honour that spec while keeping the compare
 * constant-time (lowercase both sides, then `timingSafeEqual` on equal-length
 * buffers) so a failed verify leaks no timing information.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

interface SignatureSource {
  event_type?: unknown;
  requestId?: unknown;
  data?: {
    merchant?: { userId?: unknown; walletId?: unknown };
    transaction?: { transactionId?: unknown; type?: unknown; time?: unknown; responseCode?: unknown };
  };
}

function str(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // null/undefined and any non-primitive are empty — they are not signed fields.
  return "";
}

/** Build the exact 9-field colon-joined string Nomba signs. */
export function buildSignaturePayload(parsedBody: SignatureSource, nombaTimestamp: string): string {
  const tx = parsedBody.data?.transaction ?? {};
  const merchant = parsedBody.data?.merchant ?? {};

  let responseCode = str(tx.responseCode);
  // Nomba's reference implementation maps the literal string "null" to "".
  if (responseCode === "null") responseCode = "";

  return [
    str(parsedBody.event_type),
    str(parsedBody.requestId),
    str(merchant.userId),
    str(merchant.walletId),
    str(tx.transactionId),
    str(tx.type),
    str(tx.time),
    responseCode,
    nombaTimestamp,
  ].join(":");
}

/** Compute the base64 HMAC-SHA256 signature for a raw webhook body. */
export function computeSignature(rawBody: string, secret: string, nombaTimestamp: string): string {
  const parsed = JSON.parse(rawBody) as SignatureSource;
  return computeSignatureFromParsed(parsed, secret, nombaTimestamp);
}

/**
 * Compute the signature from an already-parsed body. The signed payload is built
 * from specific field paths (not the raw bytes), so verifying from the framework's
 * parsed JSON is equivalent and avoids raw-body plumbing.
 */
export function computeSignatureFromParsed(
  parsedBody: SignatureSource,
  secret: string,
  nombaTimestamp: string,
): string {
  const payload = buildSignaturePayload(parsedBody, nombaTimestamp);
  return createHmac("sha256", secret).update(payload).digest("base64");
}

/** Constant-time, case-insensitive string compare (Nomba compares case-insensitively). */
function ciEqual(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase(), "utf8");
  const y = Buffer.from(b.toLowerCase(), "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export type SignatureScheme = "colon-base64" | "raw-hex";

/**
 * Verify the `nomba-signature` header, tolerant of BOTH documented schemes:
 *   - Developer API reference: colon-joined 9-field string → HMAC-SHA256 → base64
 *     (case-insensitive; requires the `nomba-timestamp` header).
 *   - Hackathon training material: HMAC-SHA256 of the raw JSON body → hex.
 * The shared secret gates both constructions, so accepting either does NOT weaken
 * security — an attacker still needs the secret. We return which scheme matched so
 * we can observe the real one from a live webhook and harden to it.
 */
export function verifyWebhook(args: {
  rawBody: string | undefined;
  parsedBody: unknown;
  signatureHeader: string | undefined;
  nombaTimestamp: string | undefined;
  secret: string;
}): { valid: boolean; scheme?: SignatureScheme } {
  const { rawBody, parsedBody, signatureHeader, nombaTimestamp, secret } = args;
  if (!signatureHeader) return { valid: false };

  // Scheme A — colon-joined fields → base64 (needs the timestamp header).
  if (nombaTimestamp !== undefined) {
    const a = computeSignatureFromParsed(parsedBody as SignatureSource, secret, nombaTimestamp);
    if (ciEqual(a, signatureHeader)) return { valid: true, scheme: "colon-base64" };
  }
  // Scheme B — HMAC of the raw body → hex.
  if (rawBody !== undefined && rawBody !== "") {
    const b = createHmac("sha256", secret).update(rawBody).digest("hex");
    if (ciEqual(b, signatureHeader)) return { valid: true, scheme: "raw-hex" };
  }
  return { valid: false };
}

/** Verify a signature against a parsed body (used by the HTTP webhook route). */
export function verifyWebhookSignatureParsed(args: {
  parsedBody: unknown;
  signatureHeader: string | undefined;
  nombaTimestamp: string | undefined;
  secret: string;
}): boolean {
  const { parsedBody, signatureHeader, nombaTimestamp, secret } = args;
  if (!signatureHeader || nombaTimestamp === undefined) return false;
  const expected = computeSignatureFromParsed(parsedBody as SignatureSource, secret, nombaTimestamp);
  const a = Buffer.from(expected.toLowerCase(), "utf8");
  const b = Buffer.from(signatureHeader.toLowerCase(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify the `nomba-signature` header against a freshly computed signature.
 * Returns false (never throws) on any malformed input so the caller can reject
 * cleanly. `nombaTimestamp` is the `nomba-timestamp` header value.
 */
export function verifyWebhookSignature(args: {
  rawBody: string;
  signatureHeader: string | undefined;
  nombaTimestamp: string | undefined;
  secret: string;
}): boolean {
  const { rawBody, signatureHeader, nombaTimestamp, secret } = args;
  if (!signatureHeader || nombaTimestamp === undefined) return false;

  let expected: string;
  try {
    expected = computeSignature(rawBody, secret, nombaTimestamp);
  } catch {
    return false; // unparseable body
  }

  // Case-insensitive per Nomba spec, but constant-time on the byte buffers.
  const a = Buffer.from(expected.toLowerCase(), "utf8");
  const b = Buffer.from(signatureHeader.toLowerCase(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
