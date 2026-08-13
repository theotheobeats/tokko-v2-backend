/**
 * One-off test harness for POST /api/webhooks/singapay/disbursement.
 *
 * Usage:
 *   SINGAPAY_WEBHOOK_SECRET=<secret> node docs/test-disbursement-webhook.mjs \
 *     payout-65136938-1786612656411 failed "ACCOUNT_VALIDATION_ERROR: ACCOUNT INQUIRY FAILED"
 *
 * Args: <reference_number> <settled|failed> [failed_reason]
 * Default reference_number targets the staging test payout that is currently
 * parked at "submitted" — firing this flips it to failed (and parks the linked
 * payout request back to approved).
 *
 * The HMAC scheme mirrors src/infrastructure/payments/singapay-webhook.ts:
 *   hashedBody = SHA256(JSON.stringify(sortRecursive(JSON.parse(rawBody))))
 *   stringToSign = `POST:{endpoint}:{accessToken}:{hashedBody}:{timestamp}`
 *   signature   = HMAC-SHA512(stringToSign, SINGAPAY_WEBHOOK_SECRET), hex
 */
import { createHmac, createHash } from "node:crypto";

const secret = process.env.SINGAPAY_WEBHOOK_SECRET;
if (!secret) {
  console.error("SINGAPAY_WEBHOOK_SECRET is required");
  process.exit(1);
}

const ENDPOINT = "/api/webhooks/singapay/disbursement";
const BASE = process.env.SINGAPAY_BASE_URL ?? "https://staging-api.7okko.com";

const [ref, statusArg, ...reasonParts] = process.argv.slice(2);
const referenceNumber = ref ?? "payout-65136938-1786612656411";
const status = statusArg === "failed" ? "failed" : "settled";
const failedReason = reasonParts.join(" ") ?? null;

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
  response_code: status === "failed" ? "SP001" : "SP000",
  response_message: status === "failed" ? "Failed" : "Success",
  data: {
    transaction_id: `test-dsb-${Date.now()}`,
    reference_number: referenceNumber,
    transaction_status: { code: status === "failed" ? "06" : "00", desc: status === "failed" ? "Failed" : "Success" },
    ...(status === "failed" ? { failed_reason: failedReason } : {}),
  },
};

const rawBody = JSON.stringify(payload);
const hashedBody = createHash("sha256")
  .update(JSON.stringify(sortRecursive(JSON.parse(rawBody))))
  .digest("hex");
const timestamp = String(Math.floor(Date.now() / 1000));
const accessToken = `test-${Date.now()}`;
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
