import { describe, it, expect, vi } from "vitest";
import { HandleDisbursementWebhook } from "../../../src/application/admin/admin-payouts";
import type { PayoutRepository, PayoutRecord } from "../../../src/infrastructure/repos/d1-payout-repo";
import type { PayoutRequestRepository, PayoutRequestRecord } from "../../../src/infrastructure/repos/d1-payout-request-repo";

function mockPayoutRepo(payout: PayoutRecord | null): PayoutRepository {
  return {
    create: vi.fn(),
    list: vi.fn(),
    findByRef: vi.fn().mockResolvedValue(payout),
    updateStatus: vi.fn().mockResolvedValue(undefined),
  };
}

function mockRequestRepo(request?: PayoutRequestRecord | null): PayoutRequestRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findOpenByStoreId: vi.fn(),
    findByPayoutId: vi.fn().mockResolvedValue(request ?? null),
    list: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

const payout: PayoutRecord = {
  id: "payout-1",
  storeId: "store-1",
  amount: 2_110_000,
  commission: 0,
  balanceBefore: 2_111_000,
  sweepRef: null,
  payoutRef: "payout-ref-1",
  providerTransactionId: null,
  status: "submitted",
  failedReason: null,
  createdAt: "2026-08-13 09:00:00",
};

const request: PayoutRequestRecord = {
  id: "req-1",
  storeId: "store-1",
  amount: 2_110_000,
  commission: 0,
  balanceBefore: 2_111_000,
  status: "paid",
  note: null,
  payoutId: "payout-1",
  reviewedBy: "admin-1",
  reviewedAt: "2026-08-13 09:00:00",
  decisionNote: null,
  createdAt: "2026-08-13 08:20:00",
};

describe("HandleDisbursementWebhook", () => {
  it("flips a failed disbursement and parks the linked request back to approved", async () => {
    const payoutRepo = mockPayoutRepo(payout);
    const requestRepo = mockRequestRepo(request);

    const result = await new HandleDisbursementWebhook(payoutRepo, requestRepo).execute({
      referenceNumber: "payout-ref-1",
      transactionId: "tx-failed",
      status: "failed",
      failedReason: "ACCOUNT_VALIDATION_ERROR: ACCOUNT INQUIRY FAILED",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.handled).toBe(true);
    expect(payoutRepo.updateStatus).toHaveBeenCalledWith("payout-1", {
      status: "failed",
      providerTransactionId: "tx-failed",
      failedReason: "ACCOUNT_VALIDATION_ERROR: ACCOUNT INQUIRY FAILED",
    });
    // Linked request: paid → approved (retryable), never left marked paid.
    expect(requestRepo.findByPayoutId).toHaveBeenCalledWith("payout-1");
    expect(requestRepo.update).toHaveBeenCalledWith("req-1", {
      status: "approved",
      decisionNote: "ACCOUNT_VALIDATION_ERROR: ACCOUNT INQUIRY FAILED",
    });
  });

  it("marks settled without touching the request", async () => {
    const payoutRepo = mockPayoutRepo(payout);
    const requestRepo = mockRequestRepo(request);

    const result = await new HandleDisbursementWebhook(payoutRepo, requestRepo).execute({
      referenceNumber: "payout-ref-1",
      transactionId: "tx-ok",
      status: "settled",
      failedReason: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(payoutRepo.updateStatus).toHaveBeenCalledWith("payout-1", {
      status: "settled",
      providerTransactionId: "tx-ok",
      failedReason: null,
    });
    expect(requestRepo.update).not.toHaveBeenCalled();
  });

  it("is a no-op for already-terminal payouts", async () => {
    const payoutRepo = mockPayoutRepo({ ...payout, status: "failed" });
    const requestRepo = mockRequestRepo(request);

    const result = await new HandleDisbursementWebhook(payoutRepo, requestRepo).execute({
      referenceNumber: "payout-ref-1",
      transactionId: "tx-late",
      status: "failed",
      failedReason: "late redelivery",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.handled).toBe(false);
    expect(payoutRepo.updateStatus).not.toHaveBeenCalled();
  });
});
