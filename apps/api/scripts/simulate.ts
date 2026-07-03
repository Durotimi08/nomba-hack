/**
 * Demo driver — posts a correctly-signed Nomba inbound-payment webhook at the
 * running API, so you can exercise the full reconcile pipeline (and the dashboard)
 * without waiting on a real bank transfer.
 *
 *   pnpm simulate --account-ref <ref> --amount <naira> [--type exact|under|over|dup|orphan]
 *                 [--count N] [--session ID] [--url http://localhost:3001] [--secret KEY]
 *
 * Examples:
 *   pnpm simulate --account-ref KOBO-rent-123 --amount 50000               # a payment
 *   pnpm simulate --account-ref KOBO-rent-123 --amount 60000 --type over   # overpayment → refund
 *   pnpm simulate --account-ref KOBO-rent-123 --amount 50000 --type dup --count 5  # replay → credits once
 *   pnpm simulate --type orphan --amount 5000                              # unknown sender → suspense
 *
 * The signature uses the documented colon-9-field → base64 scheme; `--secret`
 * (or NOMBA_SIGNATURE_KEY) must match what the API verifies against.
 */
import { randomUUID } from "node:crypto";
import { computeSignatureFromParsed } from "@kobo/nomba";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const type = arg("type", "exact")!;
const url = (arg("url") ?? process.env.SIMULATE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
const secret = arg("secret") ?? process.env.NOMBA_SIGNATURE_KEY;
const amount = Number(arg("amount", "50000"));
const sender = arg("sender", "JOHN GRASS")!;
const fee = Number(arg("fee", "0.6"));
// Orphans deliberately use an accountRef that maps to no customer.
const accountRef =
  type === "orphan" ? `UNKNOWN-${randomUUID()}` : (arg("account-ref") ?? arg("accountRef"));
const count = Number(arg("count", type === "dup" ? "5" : "1"));
// A dup/replay run reuses ONE sessionId to prove the ledger credits once.
const session = arg("session") ?? `SIM-${randomUUID()}`;

if (!secret) {
  console.error("Missing --secret or NOMBA_SIGNATURE_KEY.");
  process.exit(1);
}
if (type !== "orphan" && !accountRef) {
  console.error("Missing --account-ref (required unless --type orphan).");
  process.exit(1);
}
if (!Number.isFinite(amount) || amount <= 0) {
  console.error(`Invalid --amount: ${arg("amount")}`);
  process.exit(1);
}

function buildPayload(sessionId: string): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    event_type: "payment_success",
    requestId: randomUUID(),
    data: {
      merchant: { userId: "demo-user", walletId: "demo-wallet", walletBalance: 0 },
      transaction: {
        sessionId,
        transactionId: `API-VACT-${randomUUID()}`,
        type: "vact_transfer",
        aliasAccountType: "VIRTUAL",
        aliasAccountReference: accountRef ?? "",
        aliasAccountNumber: arg("va") ?? "0000000000",
        aliasAccountName: "Kobo/Customer",
        transactionAmount: amount, // naira
        fee, // naira
        responseCode: "",
        narration: `Transfer from ${sender}`,
        time: now,
      },
      customer: { senderName: sender, bankName: "Demo Bank", bankCode: "999", accountNumber: "0000000001" },
    },
  };
}

async function post(sessionId: string, attempt: number): Promise<void> {
  const payload = buildPayload(sessionId);
  const timestamp = new Date().toISOString();
  const signature = computeSignatureFromParsed(payload, secret!, timestamp);
  const res = await fetch(`${url}/webhooks/nomba`, {
    method: "POST",
    headers: { "content-type": "application/json", "nomba-signature": signature, "nomba-timestamp": timestamp },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  console.log(`  [${attempt}/${count}] session=${sessionId} → ${res.status} ${body}`);
}

console.log(
  `Simulating ${type} payment: ₦${amount} → accountRef=${accountRef ?? "(orphan)"} ` +
    `(${count}× ${count > 1 ? "same session = replay" : "single"}) at ${url}`,
);
for (let i = 1; i <= count; i++) {
  // dup/replay reuse the one session; distinct payments get fresh sessions.
  await post(type === "dup" ? session : `${session}-${i}`, i);
}
console.log("Done. Check the dashboard: KPIs, the customer statement, exceptions, and refunds.");
