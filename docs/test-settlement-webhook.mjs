/**
 * One-off test harness for POST /api/webhooks/singapay/settlement.
 *
 * Usage:
 *   SINGAPAY_CLIENT_SECRET=<secret> node docs/test-settlement-webhook.mjs
 *
 * The HMAC scheme mirrors src/infrastructure/payments/singapay-webhook.ts:
 *   hashedBody = SHA256(JSON.stringify(sortRecursive(JSON.parse(rawBody))))
 *   stringToSign = `POST:{endpoint}:{accessToken}:{hashedBody}:{timestamp}`
 *   signature   = HMAC-SHA512(stringToSign, CLIENT_SECRET), hex
 * X-Timestamp must be within 15 minutes of the worker clock.
 *
 * SingaPay signs inbound webhooks with the merchant CLIENT_SECRET (docs:
 * "Security and Signature Validation"). The legacy SINGAPAY_WEBHOOK_SECRET is
 * accepted as a fallback only for older setups.
 */
import { createHmac, createHash } from "node:crypto";

const secret = process.env.SINGAPAY_CLIENT_SECRET ?? process.env.SINGAPAY_WEBHOOK_SECRET;
if (!secret) {
  console.error("SINGAPAY_CLIENT_SECRET (or legacy SINGAPAY_WEBHOOK_SECRET) is required");
  process.exit(1);
}

const ENDPOINT = "/api/webhooks/singapay/settlement";
const BASE = process.env.SINGAPAY_BASE_URL ?? "https://staging-api.7okko.com";

function sortRecursive(value) {
  if (Array.isArray(value)) return value.map(sortRecursive);
  if (value !== null && typeof value === "object") {
    const record = {};
    for (const key of Object.keys(value).sort()) record[key] = sortRecursive(value[key]);
    return record;
  }
  return value;
}

const payload = {
  status: 200,
  success: true,
  event: "settlement.completed",
  timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
  data: {
    settlement: {
      id: 1234,
      reference_no: "SETTLEMENT-1-SAMPLE001",
      title: "Settlement Sample Merchant (2026-06-17 - 2026-06-18)",
      status: "completed",
      settlement_type: "ALL",
      settlement_method: "balance",
      is_auto_created: false,
      start_date: "12 Aug 2026 13:34:47",
      end_date: "13 Aug 2026 13:34:47",
      amount: 1000000,
      total_admin_fee: 5000,
      total_vendor_fee: 3000,
      total_our_margin: 2000,
      settlement_fee: 0,
      total_to_transfer: 1000000,
      total_refunded: 0,
      currency: "IDR",
      transfer_status: null,
      approved_by: "Sample Approver",
      approved_at: "13 Aug 2026 13:34:47",
      recipient: { bank_code: null, account_number: null, account_name: null },
    },
    total_transactions: 5,
  },
};

const rawBody = JSON.stringify(payload);
const hashedBody = createHash("sha256")
  .update(JSON.stringify(sortRecursive(JSON.parse(rawBody))))
  .digest("hex");
const timestamp = String(Math.floor(Date.now() / 1000));
const accessToken = `test-${Date.now()}`; // random — echoed in Authorization header
const stringToSign = `POST:${ENDPOINT}:${accessToken}:${hashedBody}:${timestamp}`;
const signature = createHmac("sha512", secret).update(stringToSign).digest("hex");

const res = await fetch(`${BASE}${ENDPOINT}`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-PARTNER-ID": process.env.SINGAPAY_PARTNER_ID ?? "test",
    "X-Timestamp": timestamp,
    "X-Signature": signature,
    Authorization: `Bearer ${accessToken}`,
  },
  body: rawBody,
});

console.log("HTTP", res.status);
console.log(await res.text());
