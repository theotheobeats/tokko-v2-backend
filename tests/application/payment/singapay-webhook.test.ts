import { describe, it, expect } from "vitest";
import { createHmac, createHash } from "node:crypto";
import {
  verifySingaPayWebhookSignature,
  normalizeSingaPayWebhook,
} from "../../../src/infrastructure/payments/singapay-webhook";
import { encodeSingaPayRef } from "../../../src/infrastructure/payments/singapay-ref";

const SECRET = "singapay-client-secret";
const ENDPOINT = "/api/webhooks/singapay";

/** Replicates SingaPay's signing (per their docs) using node:crypto — the "SingaPay side". */
function signPayload(body: unknown, opts: { endpoint: string; timestamp: string; token: string }): string {
  const normalized = JSON.stringify(sortRecursive(body));
  const hashedBody = createHash("sha256").update(normalized).digest("hex");
  const stringToSign = `POST:${opts.endpoint}:${opts.token}:${hashedBody}:${opts.timestamp}`;
  return createHmac("sha512", SECRET).update(stringToSign).digest("hex");
}

function sortRecursive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecursive);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = sortRecursive(record[key]);
    return sorted;
  }
  return value;
}

/** Realistic payment-link webhook payload (from SingaPay's docs example). */
function samplePayload() {
  return {
    status: 200,
    success: true,
    data: {
      transaction: {
        reff_no: "18917720251110094037705",
        type: "pl",
        status: "paid",
        amount: { value: "85000.00", currency: "IDR" },
        tip: null,
        post_timestamp: "10 Nov 2025 09:46:38",
        processed_timestamp: "10 Nov 2025 09:46:38",
      },
      customer: { id: null, name: "Rina", email: "rina@test.id", phone: "0812" },
      payment: {
        method: "payment_link",
        additional_info: {
          payment_link: {
            id: 189,
            reff_no: "tokko-order-123",
            title: "Pesanan TK-8F3K2",
            payment_date: "2025-11-05T09:09:49.000000Z",
            payment_url: "https://sandbox-paymentlink.singapay.id/b2b/PL123",
            status: "open",
            required_customer_detail: true,
            max_usage: 1,
            current_usage: 1,
            expired_at: null,
            total_amount: "85000.00",
            account_id: 35,
            created_at: "2025-11-05T09:09:49.000000Z",
            updated_at: "2025-11-10T02:46:38.000000Z",
          },
        },
      },
    },
  };
}

describe("verifySingaPayWebhookSignature", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = "jwt-abc";

  it("accepts a validly-signed payload", async () => {
    const body = samplePayload();
    const signature = signPayload(body, { endpoint: ENDPOINT, timestamp: String(now), token });
    const ok = await verifySingaPayWebhookSignature({
      rawBody: JSON.stringify(body),
      headers: { "x-signature": signature, "x-timestamp": String(now), authorization: `Bearer ${token}` },
      clientSecret: SECRET,
      endpoint: ENDPOINT,
    });
    expect(ok).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const body = samplePayload();
    const signature = signPayload(body, { endpoint: ENDPOINT, timestamp: String(now), token });
    const tampered = structuredClone(body);
    tampered.data.transaction.status = "expired";
    const ok = await verifySingaPayWebhookSignature({
      rawBody: JSON.stringify(tampered),
      headers: { "x-signature": signature, "x-timestamp": String(now), authorization: `Bearer ${token}` },
      clientSecret: SECRET,
      endpoint: ENDPOINT,
    });
    expect(ok).toBe(false);
  });

  it("rejects a wrong endpoint (config mismatch)", async () => {
    const body = samplePayload();
    const signature = signPayload(body, { endpoint: ENDPOINT, timestamp: String(now), token });
    const ok = await verifySingaPayWebhookSignature({
      rawBody: JSON.stringify(body),
      headers: { "x-signature": signature, "x-timestamp": String(now), authorization: `Bearer ${token}` },
      clientSecret: SECRET,
      endpoint: "/other/path",
    });
    expect(ok).toBe(false);
  });

  it("rejects a stale timestamp (replay protection)", async () => {
    const body = samplePayload();
    const stale = now - 60 * 60; // 1 hour old
    const signature = signPayload(body, { endpoint: ENDPOINT, timestamp: String(stale), token });
    const ok = await verifySingaPayWebhookSignature({
      rawBody: JSON.stringify(body),
      headers: { "x-signature": signature, "x-timestamp": String(stale), authorization: `Bearer ${token}` },
      clientSecret: SECRET,
      endpoint: ENDPOINT,
    });
    expect(ok).toBe(false);
  });

  it("rejects missing headers", async () => {
    const ok = await verifySingaPayWebhookSignature({
      rawBody: JSON.stringify(samplePayload()),
      headers: {},
      clientSecret: SECRET,
      endpoint: ENDPOINT,
    });
    expect(ok).toBe(false);
  });
});

describe("normalizeSingaPayWebhook", () => {
  it("maps a paid payment-link webhook to the internal shape", () => {
    const normalized = normalizeSingaPayWebhook(samplePayload());
    expect(normalized).toEqual({
      external_id: "tokko-order-123",
      status: "PAID",
      paid_at: "2025-11-05T09:09:49.000000Z",
      payment_method: "payment_link",
      amount: 85000,
    });
  });

  it("decodes a compact-encoded plan reff_no back to the canonical id", () => {
    const canonical = `tokko-sub::550e8400-e29b-41d4-a716-446655440000::commerce::annual::1723456789012`;
    const base = samplePayload();
    base.data.payment.additional_info.payment_link.reff_no = encodeSingaPayRef(canonical);

    const normalized = normalizeSingaPayWebhook(base);
    // nonce is regenerated by the encoding — compare everything else.
    expect(normalized?.external_id).toMatch(
      /^tokko-sub::550e8400-e29b-41d4-a716-446655440000::commerce::annual::[0-9a-f]{4}$/,
    );
    expect(normalized?.status).toBe("PAID");
  });

  it("returns null without a usable reference", () => {
    expect(normalizeSingaPayWebhook({ data: { transaction: {} } })).toBeNull();
    expect(normalizeSingaPayWebhook({})).toBeNull();
  });

  it("maps lower-case statuses to the internal uppercase set", () => {
    const base = samplePayload();
    const expired = structuredClone(base);
    expired.data.transaction.status = "expired";
    expect(normalizeSingaPayWebhook(expired)?.status).toBe("EXPIRED");
    const pending = structuredClone(base);
    pending.data.transaction.status = "pending";
    expect(normalizeSingaPayWebhook(pending)?.status).toBe("PENDING");
  });
});
