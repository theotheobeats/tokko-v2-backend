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
 *   Replay protection: `X-Timestamp` (Unix seconds) must be within 15 minutes.
 *
 * The payment link webhook carries our reference back in
 * `data.payment.additional_info.payment_link.reff_no` — that is the external
 * id we set at link creation, so it maps 1:1 to the internal payment rows.
 */

import { hmacSha512Hex } from "./singapay-client";
import { decodeSingaPayRef } from "./singapay-ref";

export interface SingaPayWebhookHeaders {
  "x-signature"?: string | null;
  "x-timestamp"?: string | null;
  authorization?: string | null;
}

export interface SingaPayWebhookPayload {
  /** Event kind, e.g. "payment-link-transaction" (SingaPay notification). */
  event?: string;
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

/**
 * SingaPay disbursement-transaction notification (money-out result), per
 * their docs (/docs/v1/webhooks/disbursement-transaction).
 */
export interface SingaPayDisbursementWebhookPayload {
  response_code?: string;
  response_message?: string;
  data?: {
    transaction_id?: string;
    /** Our idempotency key — set as `reference_number` at transfer time. */
    reference_number?: string;
    transaction_status?: { code?: string; desc?: string };
    failed_reason?: string | null;
    failed_code?: string | null;
  };
}

/** Internal disbursement-webhook shape — feeds the payout status use case. */
export interface NormalizedSingaPayDisbursementWebhook {
  referenceNumber: string;
  transactionId: string | null;
  status: "submitted" | "settled" | "failed";
  failedReason: string | null;
}

/**
 * SingaPay settlement notification (clearing process), per their docs
 * (/api-reference/webhooks/settlement). Fires when a settlement batch moves
 * funds between pending_balance, available_balance and the bank account.
 */
export interface SingaPaySettlementWebhookPayload {
  event?: string;
  data?: {
    settlement?: {
      reference_no?: string;
      title?: string | null;
      settlement_type?: string | null;
      settlement_method?: string | null;
      start_date?: string | null;
      end_date?: string | null;
      amount?: number;
      total_admin_fee?: number;
      total_vendor_fee?: number;
      total_our_margin?: number;
      settlement_fee?: number;
      total_to_transfer?: number;
      total_refunded?: number;
      status?: string | null;
      approved_by?: string | null;
      approved_at?: string | null;
      /** Defensive: not in the documented payload, but some batches may carry it. */
      account_id?: string | number | null;
    };
    total_transactions?: number;
    refund?: {
      account_id?: string | number | null;
      net_amount?: { value?: string | number; currency?: string };
    };
  };
}

/** Internal settlement-webhook shape — feeds the clearing-history use case. */
export interface NormalizedSingaPaySettlementWebhook {
  event: "settlement.completed" | "settlement.refunded" | "settlement.refund_cancelled";
  settlement: {
    referenceNo: string;
    batchTitle: string | null;
    settlementType: string | null;
    method: string | null;
    startDate: string | null;
    endDate: string | null;
    amount: number;
    totalAdminFee: number;
    totalVendorFee: number;
    totalOurMargin: number;
    settlementFee: number;
    totalToTransfer: number;
    totalRefunded: number;
    totalTransactions: number;
    status: string;
    approvedBy: string | null;
    approvedAt: string | null;
    accountId: string | null;
  };
  refund: { accountId: string | null; netAmount: number } | null;
}

// Replay protection window. SingaPay delivers webhooks with latency and
// retries ~5 minutes after the transaction timestamp (prod incident: a paid
// subscription webhook was rejected because delivery landed 5s past the old
// 5-minute window). 15 minutes tolerates retries while still rejecting
// genuine replays (the HMAC is the real auth; this is just staleness).
const TIMESTAMP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * HMAC key for inbound webhook verification.
 *
 * Per SingaPay docs (Security and Signature Validation), webhooks are signed
 * with the merchant's CLIENT_SECRET — a separate "webhook secret" is never
 * used by SingaPay (prod incident: every webhook 401'd because we verified
 * with SINGAPAY_WEBHOOK_SECRET). Fall back to the legacy webhook secret only
 * if the client secret is missing, so older setups keep working.
 */
export function resolveWebhookSecret(env: {
  SINGAPAY_CLIENT_SECRET?: string;
  SINGAPAY_WEBHOOK_SECRET?: string;
}): string | null {
  return env.SINGAPAY_CLIENT_SECRET ?? env.SINGAPAY_WEBHOOK_SECRET ?? null;
}

async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export { sha256Hex };

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

export { sortRecursive };

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

  if (!received || !timestamp) {
    console.warn("[singapay-webhook] rejected: missing signing headers", {
      endpoint,
      hasSignature: Boolean(received),
      hasTimestamp: Boolean(timestamp),
      hasToken: Boolean(accessToken),
    });
    return false;
  }

  // Replay protection: reject stale timestamps.
  const tsMs = Number(timestamp) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > TIMESTAMP_WINDOW_MS) {
    console.warn("[singapay-webhook] rejected: timestamp outside replay window", {
      endpoint,
      timestamp,
      ageSeconds: Number.isFinite(tsMs) ? Math.round((Date.now() - tsMs) / 1000) : null,
    });
    return false;
  }

  let bodyObject: unknown;
  try {
    bodyObject = JSON.parse(rawBody);
  } catch {
    console.warn("[singapay-webhook] rejected: unparseable body");
    return false;
  }

  const normalizedJson = JSON.stringify(sortRecursive(bodyObject));
  const hashedBody = await sha256Hex(normalizedJson);
  const stringToSign = `POST:${endpoint}:${accessToken}:${hashedBody}:${timestamp}`;
  const calculated = await hmacSha512Hex(clientSecret, stringToSign);

  // Constant-time comparison (timing-safe).
  if (calculated.length !== received.length) {
    console.warn("[singapay-webhook] signature mismatch (length)", {
      endpoint,
      receivedLen: received.length,
      calculatedLen: calculated.length,
    });
    return false;
  }
  let diff = 0;
  for (let i = 0; i < calculated.length; i++) {
    diff |= calculated.charCodeAt(i) ^ received.charCodeAt(i);
  }
  if (diff !== 0) {
    // HMAC prefixes pinpoint the cause: same prefix = right secret, wrong
    // body/endpoint/timestamp/token; different prefix = wrong key (e.g. the
    // legacy webhook secret instead of the CLIENT_SECRET).
    console.warn("[singapay-webhook] signature mismatch (HMAC differs)", {
      endpoint,
      receivedPrefix: received.slice(0, 16),
      calculatedPrefix: calculated.slice(0, 16),
      timestamp,
      hasToken: Boolean(accessToken),
    });
    return false;
  }
  return true;
}

/** Map a SingaPay payment-link webhook to the internal payload shape. */
export function normalizeSingaPayWebhook(
  payload: SingaPayWebhookPayload,
): NormalizedSingaPayWebhook | null {
  const link = payload?.data?.payment?.additional_info?.payment_link;
  const tx = payload?.data?.transaction;

  // Prefer the payment link's reference (ours); fall back to the tx ref.
  const ref = link?.reff_no || tx?.reff_no;
  if (!ref) return null;

  // Plan refs are compact-encoded (>40-char canonical ids) — decode them back.
  const externalId = decodeSingaPayRef(ref) ?? ref;

  const amount = tx?.amount?.value;
  return {
    external_id: externalId,
    status: ((tx?.status ?? "pending").toUpperCase() as NormalizedSingaPayWebhook["status"]),
    paid_at: link?.payment_date ?? null,
    payment_method: payload?.data?.payment?.method ?? null,
    amount: amount !== undefined && amount !== null ? Number(amount) : undefined,
  };
}

/**
 * Map a SingaPay disbursement-transaction notification to the internal shape.
 * Status codes per SingaPay docs: "00" = Success, "06" = Failed; the envelope's
 * response_code mirrors it ("SP000" success / "SP001" failure). Unknown codes
 * map to "submitted" (keep waiting — never assume success).
 */
export function normalizeSingaPayDisbursementWebhook(
  payload: SingaPayDisbursementWebhookPayload,
): NormalizedSingaPayDisbursementWebhook | null {
  const data = payload?.data;
  const referenceNumber = data?.reference_number;
  if (!referenceNumber) return null;

  const code = data?.transaction_status?.code ?? "";
  const desc = (data?.transaction_status?.desc ?? "").toLowerCase();
  const envelopeCode = payload?.response_code ?? "";

  const isFailed = code === "06" || desc.includes("fail") || envelopeCode === "SP001";
  const isSuccess = code === "00" || desc.includes("success") || envelopeCode === "SP000";

  return {
    referenceNumber,
    transactionId: data?.transaction_id ?? null,
    status: isFailed ? "failed" : isSuccess ? "settled" : "submitted",
    failedReason: data?.failed_reason ?? null,
  };
}

const SETTLEMENT_EVENTS = new Set(["settlement.completed", "settlement.refunded", "settlement.refund_cancelled"]);

/** Map a SingaPay settlement notification to the internal shape (clearing). */
export function normalizeSingaPaySettlementWebhook(
  payload: SingaPaySettlementWebhookPayload,
): NormalizedSingaPaySettlementWebhook | null {
  const event = payload?.event;
  if (!event || !SETTLEMENT_EVENTS.has(event)) return null;

  const s = payload?.data?.settlement;
  const referenceNo = s?.reference_no;
  if (!referenceNo) return null;

  const n = (v: number | undefined) => Number(v ?? 0);
  const accountIdRaw = s?.account_id ?? payload?.data?.refund?.account_id ?? null;

  return {
    event: event as NormalizedSingaPaySettlementWebhook["event"],
    settlement: {
      referenceNo,
      batchTitle: s?.title ?? null,
      settlementType: s?.settlement_type ?? null,
      method: s?.settlement_method ?? null,
      startDate: s?.start_date ?? null,
      endDate: s?.end_date ?? null,
      amount: n(s?.amount),
      totalAdminFee: n(s?.total_admin_fee),
      totalVendorFee: n(s?.total_vendor_fee),
      totalOurMargin: n(s?.total_our_margin),
      settlementFee: n(s?.settlement_fee),
      totalToTransfer: n(s?.total_to_transfer),
      totalRefunded: n(s?.total_refunded),
      totalTransactions: n(payload?.data?.total_transactions),
      status: s?.status ?? "completed",
      approvedBy: s?.approved_by ?? null,
      approvedAt: s?.approved_at ?? null,
      accountId: accountIdRaw !== null && accountIdRaw !== undefined ? String(accountIdRaw) : null,
    },
    refund: payload?.data?.refund
      ? {
          accountId:
            payload.data.refund.account_id !== null && payload.data.refund.account_id !== undefined
              ? String(payload.data.refund.account_id)
              : null,
          netAmount: n(payload.data.refund.net_amount?.value as number | undefined),
        }
      : null,
  };
}
