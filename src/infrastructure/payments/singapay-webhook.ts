/**
 * SingaPay webhook verification + payload normalization.
 *
 * Signature scheme (per SingaPay's security docs):
 *   1. Normalize the raw JSON body — recursively sort object keys
 *      alphabetically, re-encode compactly (no spaces, unescaped slashes).
 *   2. hashedBody = SHA-256 hex of the normalized JSON.
 *   3. StringToSign = `POST:{endpoint}:{accessToken}:{hashedBody}:{timestamp}`
 *      where `endpoint` is the registered webhook path exactly as configured
 *      (e.g. `/api/webhooks/singapay`).
 *   4. calculated = HMAC-SHA512(StringToSign, client_secret), lowercase hex.
 *   5. Constant-time compare with the `X-Signature` header.
 *   Replay protection: `X-Timestamp` (Unix seconds) must be within 5 minutes.
 *
 * The payment link webhook carries our reference back in
 * `data.payment.additional_info.payment_link.reff_no` — that is the external
 * id we set at link creation, so it maps 1:1 to the internal payment rows.
 */

import { hmacSha512Hex } from "./singapay-client";

export interface SingaPayWebhookHeaders {
  "x-signature"?: string | null;
  "x-timestamp"?: string | null;
  authorization?: string | null;
}

export interface SingaPayWebhookPayload {
  data?: {
    transaction?: {
      reff_no?: string;
      type?: string;
      status?: string;
      amount?: { value?: string | number; currency?: string };
    };
    payment?: {
      method?: string;
      additional_info?: {
        payment_link?: { reff_no?: string; payment_date?: string | null };
      };
    };
  };
}

/** Internal webhook shape — matches the shared HandlePaymentWebhook use case. */
export interface NormalizedSingaPayWebhook {
  external_id: string;
  status: "PENDING" | "PAID" | "EXPIRED" | "FAILED";
  paid_at?: string | null;
  payment_method?: string | null;
  amount?: number;
}

const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes — replay protection

async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Recursively sort object keys alphabetically (arrays keep their order). */
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

export async function verifySingaPayWebhookSignature(params: {
  rawBody: string;
  headers: SingaPayWebhookHeaders;
  clientSecret: string;
  /** Registered webhook path exactly as configured, e.g. "/api/webhooks/singapay". */
  endpoint: string;
}): Promise<boolean> {
  const { rawBody, headers, clientSecret, endpoint } = params;
  const received = headers["x-signature"] ?? "";
  const timestamp = headers["x-timestamp"] ?? "";
  const accessToken = (headers["authorization"] ?? "").replace(/^Bearer\s+/i, "");

  if (!received || !timestamp) return false;

  // Replay protection: reject stale timestamps.
  const tsMs = Number(timestamp) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > TIMESTAMP_WINDOW_MS) return false;

  let bodyObject: unknown;
  try {
    bodyObject = JSON.parse(rawBody);
  } catch {
    return false;
  }

  const normalizedJson = JSON.stringify(sortRecursive(bodyObject));
  const hashedBody = await sha256Hex(normalizedJson);
  const stringToSign = `POST:${endpoint}:${accessToken}:${hashedBody}:${timestamp}`;
  const calculated = await hmacSha512Hex(clientSecret, stringToSign);

  // Constant-time comparison (timing-safe).
  if (calculated.length !== received.length) return false;
  let diff = 0;
  for (let i = 0; i < calculated.length; i++) {
    diff |= calculated.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return diff === 0;
}

/** Map a SingaPay payment-link webhook to the internal payload shape. */
export function normalizeSingaPayWebhook(
  payload: SingaPayWebhookPayload,
): NormalizedSingaPayWebhook | null {
  const link = payload?.data?.payment?.additional_info?.payment_link;
  const tx = payload?.data?.transaction;

  // Prefer the payment link's reference (ours); fall back to the tx ref.
  const externalId = link?.reff_no || tx?.reff_no;
  if (!externalId) return null;

  const amount = tx?.amount?.value;
  return {
    external_id: externalId,
    status: ((tx?.status ?? "pending").toUpperCase() as NormalizedSingaPayWebhook["status"]),
    paid_at: link?.payment_date ?? null,
    payment_method: payload?.data?.payment?.method ?? null,
    amount: amount !== undefined && amount !== null ? Number(amount) : undefined,
  };
}
