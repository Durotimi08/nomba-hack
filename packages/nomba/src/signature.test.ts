import { describe, expect, it } from "vitest";
import { buildSignaturePayload, computeSignature, verifyWebhookSignature } from "./signature.js";

const SECRET = "test-signature-key";
const TS = "2026-02-06T10:21:57Z";

const body = JSON.stringify({
  event_type: "payment_success",
  requestId: "req-123",
  data: {
    merchant: { userId: "user-1", walletId: "wallet-1" },
    transaction: {
      transactionId: "tx-1",
      type: "vact_transfer",
      time: "2026-02-06T10:21:56Z",
      responseCode: "",
      sessionId: "sess-1",
      transactionAmount: 120,
      fee: 0.6,
    },
  },
});

describe("buildSignaturePayload", () => {
  it("joins exactly 9 fields in order with colons", () => {
    const payload = buildSignaturePayload(JSON.parse(body), TS);
    expect(payload).toBe(
      ["payment_success", "req-123", "user-1", "wallet-1", "tx-1", "vact_transfer", "2026-02-06T10:21:56Z", "", TS].join(
        ":",
      ),
    );
  });

  it('maps the literal string "null" responseCode to empty', () => {
    // `time` and the timestamp contain colons, so compare whole payloads rather
    // than splitting: a "null" responseCode must hash identically to "".
    const withNull = JSON.parse(body);
    withNull.data.transaction.responseCode = "null";
    const withEmpty = JSON.parse(body);
    withEmpty.data.transaction.responseCode = "";
    expect(buildSignaturePayload(withNull, TS)).toBe(buildSignaturePayload(withEmpty, TS));
    // A real response code must NOT collapse to empty.
    const withCode = JSON.parse(body);
    withCode.data.transaction.responseCode = "00";
    expect(buildSignaturePayload(withCode, TS)).not.toBe(buildSignaturePayload(withEmpty, TS));
  });

  it("treats missing fields as empty strings", () => {
    const payload = buildSignaturePayload({ event_type: "x" }, TS);
    expect(payload).toBe(`x:::::::${"" /* responseCode */}:${TS}`);
  });
});

describe("verifyWebhookSignature", () => {
  const signature = computeSignature(body, SECRET, TS);

  it("accepts a valid signature", () => {
    expect(
      verifyWebhookSignature({
        rawBody: body,
        signatureHeader: signature,
        nombaTimestamp: TS,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it("accepts a valid signature case-insensitively", () => {
    expect(
      verifyWebhookSignature({
        rawBody: body,
        signatureHeader: signature.toUpperCase(),
        nombaTimestamp: TS,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it("rejects tampering with a SIGNED field (transactionId)", () => {
    const tampered = body.replace("tx-1", "tx-evil");
    expect(
      verifyWebhookSignature({
        rawBody: tampered,
        signatureHeader: signature,
        nombaTimestamp: TS,
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("does NOT detect tampering with UNSIGNED fields (amount/sessionId)", () => {
    // Documented limitation: Nomba signs only 9 fields — the amount, fee,
    // sessionId, and aliasAccountReference are NOT among them. TLS protects
    // transit, and the sessionId UNIQUE constraint is the integrity control
    // for the amount path.
    const tampered = body.replace("120", "999999");
    expect(
      verifyWebhookSignature({
        rawBody: tampered,
        signatureHeader: signature,
        nombaTimestamp: TS,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it("rejects a wrong secret", () => {
    expect(
      verifyWebhookSignature({
        rawBody: body,
        signatureHeader: signature,
        nombaTimestamp: TS,
        secret: "wrong",
      }),
    ).toBe(false);
  });

  it("rejects when the timestamp differs from the one signed", () => {
    expect(
      verifyWebhookSignature({
        rawBody: body,
        signatureHeader: signature,
        nombaTimestamp: "different",
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects missing header or timestamp", () => {
    expect(
      verifyWebhookSignature({ rawBody: body, signatureHeader: undefined, nombaTimestamp: TS, secret: SECRET }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({ rawBody: body, signatureHeader: signature, nombaTimestamp: undefined, secret: SECRET }),
    ).toBe(false);
  });

  it("rejects an unparseable body without throwing", () => {
    expect(
      verifyWebhookSignature({
        rawBody: "not json",
        signatureHeader: signature,
        nombaTimestamp: TS,
        secret: SECRET,
      }),
    ).toBe(false);
  });
});
