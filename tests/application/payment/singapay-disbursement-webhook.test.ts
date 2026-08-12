import { describe, it, expect, vi } from "vitest";
import { createHmac, createHash } from "node:crypto";
import {
  verifySingaPayWebhookSignature,
  normalizeSingaPayDisbursementWebhook,
  type SingaPayDisbursementWebhookPayload,
} from "../../../src/infrastructure/payments/singapay-webhook";
import {
  HandleDisbursementWebhook,
  PayoutNotFoundError,
} from "../../../src/application/admin/admin-payouts";
import type { PayoutRepository, PayoutRecord } from "../../../src/infrastructure/repos/d1-payout-repo";

const SECRET = "singapay-client-secret";
const ENDPOINT = "/api/webhooks/singapay/disbursement";

/** Replicates SingaPay's signing (per their docs) using node:crypto. */
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

/** Disbursement notification examples — mirror SingaPay's docs
 *  (/docs/v1/webhooks/disbursement-transaction). */
function successNotification(ref = "payout-abc12345-1723456789012"): SingaPayDisbursementWebhookPayload {
  return {
    response_code: "SP000",
    response_message: "Successfully",
    data: {
      transaction_id: "101222025122910292195055674",
      reference_number: ref,
      transaction_status: { code: "00", desc: "Success" },
      post_timestamp: "1766978961000",
      processed_timestamp: "1766978962000",
      bank: { code: "002", name: "BRI", account_number: "11111111118" },
      net_amount: { currency: "IDR", value: "10001.00" },
      balance_after: { currency: "IDR", value: "829988" },
      notes: "test transfer",
    },
  };
}

function failedNotification(ref = "payout-abc12345-1723456789012"): SingaPayDisbursementWebhookPayload {
  return {
    response_code: "SP001",
    response_message: "Transaction Failure",
    data: {
      transaction_id: "121222025122617513896515436",
      reference_number: ref,
      transaction_status: { code: "06", desc: "Failed" },
      bank: { code: "002", name: "BRI", account_number: "091701064838533" },
      gross_amount: { currency: "IDR", value: "12501.00" },
      net_amount: { currency: "IDR", value: "10001.00" },
      failed_reason: "Transaction Failure : Invalid beneficiary account: Account inactive",
      failed_code: "SP001",
    },
  };
}

function makeRecord(overrides?: Partial<PayoutRecord>): PayoutRecord {
  return {
    id: "payout-1",
    storeId: "store-1",
    amount: 1_000_000,
    commission: 25_000,
    balanceBefore: 1_025_000,
    sweepRef: "at-1",
    payoutRef: "payout-abc12345-1723456789012",
    providerTransactionId: null,
    status: "submitted",
    failedReason: null,
    createdAt: "2026-08-12T00:00:00Z",
    ...overrides,
  };
}

function mockPayoutRepo(record: PayoutRecord | null): PayoutRepository & { updateStatus: ReturnType<typeof vi.fn> } {
  const updateStatus = vi.fn().mockResolvedValue(undefined);
  return {
    create: vi.fn(),
    list: vi.fn().mockResolvedValue({ payouts: [], total: 0 }),
    findByRef: vi.fn().mockResolvedValue(record),
    updateStatus,
  };
}

describe("verifySingaPayWebhookSignature (disbursement endpoint)", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = "jwt-abc";

  it("accepts a validly-signed disbursement payload", async () => {
    const body = successNotification();
    const signature = signPayload(body, { endpoint: ENDPOINT, timestamp: String(now), token });
    const ok = await verifySingaPayWebhookSignature({
      rawBody: JSON.stringify(body),
      headers: { "x-signature": signature, "x-timestamp": String(now), authorization: `Bearer ${token}` },
      clientSecret: SECRET,
      endpoint: ENDPOINT,
    });
    expect(ok).toBe(true);
  });

  it("rejects a signature built for the payment endpoint (path mismatch)", async () => {
    const body = successNotification();
    const signature = signPayload(body, { endpoint: "/api/webhooks/singapay", timestamp: String(now), token });
    const ok = await verifySingaPayWebhookSignature({
      rawBody: JSON.stringify(body),
      headers: { "x-signature": signature, "x-timestamp": String(now), authorization: `Bearer ${token}` },
      clientSecret: SECRET,
      endpoint: ENDPOINT,
    });
    expect(ok).toBe(false);
  });
});

describe("normalizeSingaPayDisbursementWebhook", () => {
  it("maps a success notification to settled", () => {
    expect(normalizeSingaPayDisbursementWebhook(successNotification())).toEqual({
      referenceNumber: "payout-abc12345-1723456789012",
      transactionId: "101222025122910292195055674",
      status: "settled",
      failedReason: null,
    });
  });

  it("maps a failure notification to failed with the reason", () => {
    expect(normalizeSingaPayDisbursementWebhook(failedNotification())).toEqual({
      referenceNumber: "payout-abc12345-1723456789012",
      transactionId: "121222025122617513896515436",
      status: "failed",
      failedReason: "Transaction Failure : Invalid beneficiary account: Account inactive",
    });
  });

  it("keeps unknown status codes as submitted (never assume success)", () => {
    const pending = successNotification();
    pending.response_code = undefined;
    pending.response_message = undefined;
    pending.data!.transaction_status = { code: "03", desc: "Pending" };
    expect(normalizeSingaPayDisbursementWebhook(pending)?.status).toBe("submitted");
  });

  it("returns null without a reference number", () => {
    expect(normalizeSingaPayDisbursementWebhook({ data: {} })).toBeNull();
    expect(normalizeSingaPayDisbursementWebhook({})).toBeNull();
  });
});

describe("HandleDisbursementWebhook", () => {
  it("settles a submitted payout", async () => {
    const repo = mockPayoutRepo(makeRecord());
    const result = await new HandleDisbursementWebhook(repo).execute({
      referenceNumber: "payout-abc12345-1723456789012",
      transactionId: "101222025122910292195055674",
      status: "settled",
      failedReason: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.handled).toBe(true);
    expect(repo.updateStatus).toHaveBeenCalledWith("payout-1", {
      status: "settled",
      providerTransactionId: "101222025122910292195055674",
      failedReason: null,
    });
  });

  it("marks a failed payout with the provider reason", async () => {
    const repo = mockPayoutRepo(makeRecord());
    const result = await new HandleDisbursementWebhook(repo).execute({
      referenceNumber: "payout-abc12345-1723456789012",
      transactionId: "121222025122617513896515436",
      status: "failed",
      failedReason: "Transaction Failure : Invalid beneficiary account",
    });

    expect(result.ok).toBe(true);
    expect(repo.updateStatus).toHaveBeenCalledWith("payout-1", {
      status: "failed",
      providerTransactionId: "121222025122617513896515436",
      failedReason: "Transaction Failure : Invalid beneficiary account",
    });
  });

  it("is idempotent — does not touch an already-settled payout", async () => {
    const repo = mockPayoutRepo(makeRecord({ status: "settled" }));
    const result = await new HandleDisbursementWebhook(repo).execute({
      referenceNumber: "payout-abc12345-1723456789012",
      transactionId: "101222025122910292195055674",
      status: "settled",
      failedReason: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.handled).toBe(false);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it("returns PAYOUT_NOT_FOUND for an unknown reference", async () => {
    const repo = mockPayoutRepo(null);
    const result = await new HandleDisbursementWebhook(repo).execute({
      referenceNumber: "payout-nope-1",
      transactionId: null,
      status: "settled",
      failedReason: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(PayoutNotFoundError);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });
});
