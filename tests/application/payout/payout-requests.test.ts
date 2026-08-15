import { describe, it, expect, vi } from "vitest";
import {
  CreatePayoutRequest,
  CancelPayoutRequest,
  ReviewPayoutRequest,
  PayoutRequestExistsError,
  PayoutRequestInvalidAmountError,
  PayoutRequestNotOwnedError,
  PayoutRequestNotReviewableError,
  PayoutTierRequiredError,
  PayoutInsufficientBalanceError,
  PayoutKYBNotVerifiedError,
  PayoutNoAccountError,
  PayoutNoBankError,
} from "../../../src/application/payout/payout-requests";
import { Store } from "../../../src/domain/store/store";
import { BusinessType, Aesthetic } from "../../../src/domain/store/types";
import { Subscription } from "../../../src/domain/plan/subscription";
import { createEntityId } from "../../../src/domain/shared/types";
import { EMPTY_TEST_ACCESS } from "../../../src/application/payout/test-access";
import type { StoreRepository } from "../../../src/application/store/store-repo";
import type { CommissionLedger } from "../../../src/infrastructure/repos/d1-commission-ledger";
import type { PayoutRequestRepository, PayoutRequestRecord } from "../../../src/infrastructure/repos/d1-payout-request-repo";
import type { PayoutRepository, PayoutRecord } from "../../../src/infrastructure/repos/d1-payout-repo";
import type { SingaPayAccountsClientLike } from "../../../src/infrastructure/payments/singapay-client";

const ownerId = createEntityId();

function makeStore() {
  return Store.create({
    ownerId,
    name: "Anna Bakery",
    businessType: BusinessType.Food,
    aestheticPreference: Aesthetic.Warm,
    whatsappNumber: "628123456789",
  })
    .updatePaymentProviderAccount("acc-anna-bakery", "kyb_verified")
    .setPayoutBank({ code: "014", accountNumber: "1234567890", accountName: "Anna" });
}

function mockStoreRepo(store?: Store | null): StoreRepository {
  return {
    findById: vi.fn().mockResolvedValue(store ?? null),
    findBySubdomain: vi.fn().mockResolvedValue(null),
    findByOwnerId: vi.fn().mockResolvedValue(null),
    findBySingapayAccountId: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    countProducts: vi.fn().mockResolvedValue(0),
    countPhysicalProductsMissingShipping: vi.fn().mockResolvedValue(0),
    countPhysicalProducts: vi.fn().mockResolvedValue(1),
    listAll: vi.fn().mockResolvedValue({ stores: [], total: 0 }),
    countAll: vi.fn().mockResolvedValue({ total: 0, published: 0, draft: 0, suspended: 0 }),
    delete: vi.fn().mockResolvedValue(undefined),
    listByTrialSet: vi.fn().mockResolvedValue([]),
    listPausedBefore: vi.fn().mockResolvedValue([]),
  };
}

function mockLedger(sum = 0): CommissionLedger {
  return {
    record: vi.fn().mockResolvedValue(undefined),
    sumByStoreId: vi.fn().mockResolvedValue(sum),
    listByStoreId: vi.fn().mockResolvedValue([]),
  };
}

function mockAccounts(balance = { available: 1_250_000, balance: 1_250_000, pending: 0, held: 0 }): SingaPayAccountsClientLike {
  return {
    createSubAccount: vi.fn(),
    getAccount: vi.fn(),
    listPaymentMethods: vi.fn(),
    checkBalance: vi.fn().mockResolvedValue(balance),
    checkFee: vi.fn(),
    checkBeneficiary: vi.fn(),
    disburse: vi.fn().mockResolvedValue({
      transactionId: "mock-dsb",
      referenceNumber: "payout-ref",
      status: "SUCCESS",
      netAmount: 1_000_000,
      fee: 0,
      failedReason: null,
    }),
    accountTransfer: vi.fn().mockResolvedValue({ transactionId: "mock-at", status: "success" }),
  };
}

function mockRequestRepo(open?: PayoutRequestRecord | null): PayoutRequestRepository {
  return {
    create: vi.fn().mockImplementation(async (input) => ({
      ...input,
      id: "req-1",
      createdAt: new Date().toISOString(),
    })),
    findById: vi.fn().mockResolvedValue(null),
    findOpenByStoreId: vi.fn().mockResolvedValue(open ?? null),
    list: vi.fn().mockResolvedValue({ requests: [], total: 0 }),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

function mockPayoutRepo(): PayoutRepository {
  return {
    create: vi.fn().mockImplementation(async (input): Promise<PayoutRecord> => ({
      ...input,
      id: "payout-1",
      createdAt: new Date().toISOString(),
    })),
    list: vi.fn().mockResolvedValue({ payouts: [], total: 0 }),
    findByRef: vi.fn().mockResolvedValue(null),
    updateStatus: vi.fn().mockResolvedValue(undefined),
  };
}

describe("CreatePayoutRequest", () => {
  it("creates a pending request for the ready amount by default", async () => {
    const store = makeStore();
    const storeRepo = mockStoreRepo(store);
    const requestRepo = mockRequestRepo();
    const accounts = mockAccounts();

    const result = await new CreatePayoutRequest(storeRepo, mockLedger(50_000), requestRepo, accounts).execute(
      store.id,
      {},
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request.status).toBe("pending");
    expect(result.value.request.amount).toBe(1_200_000); // 1_250_000 - 50_000
    expect(result.value.request.commission).toBe(50_000);
    expect(result.value.readyToPayout).toBe(1_200_000);
  });

  it("honors an explicit amount within the ready balance", async () => {
    const store = makeStore();
    const storeRepo = mockStoreRepo(store);
    const requestRepo = mockRequestRepo();

    const result = await new CreatePayoutRequest(storeRepo, mockLedger(50_000), requestRepo, mockAccounts()).execute(
      store.id,
      { amount: 500_000, note: "butuh modal" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request.amount).toBe(500_000);
    expect(result.value.request.note).toBe("butuh modal");
  });

  it("rejects an amount above the ready balance", async () => {
    const store = makeStore();
    const result = await new CreatePayoutRequest(
      mockStoreRepo(store),
      mockLedger(0),
      mockRequestRepo(),
      mockAccounts({ available: 100_000, balance: 100_000, pending: 0, held: 0 }),
    ).execute(store.id, { amount: 200_000 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PayoutRequestInvalidAmountError);
  });

  it("rejects when there is no ready balance", async () => {
    const store = makeStore();
    const result = await new CreatePayoutRequest(
      mockStoreRepo(store),
      mockLedger(0),
      mockRequestRepo(),
      mockAccounts({ available: 0, balance: 0, pending: 0, held: 0 }),
    ).execute(store.id, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PayoutInsufficientBalanceError);
  });

  it("rejects when KYB is not verified", async () => {
    const store = Store.create({
      ownerId,
      name: "Anna Bakery",
      businessType: BusinessType.Food,
      aestheticPreference: Aesthetic.Warm,
      whatsappNumber: "628123456789",
    }).updatePaymentProviderAccount("acc-anna", "kyb_in_review");

    const result = await new CreatePayoutRequest(mockStoreRepo(store), mockLedger(0), mockRequestRepo(), mockAccounts()).execute(
      store.id,
      {},
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PayoutKYBNotVerifiedError);
  });

  it("rejects when the payout bank is missing", async () => {
    const store = makeStore().setPayoutBank({ code: "014", accountNumber: "", accountName: null });
    const result = await new CreatePayoutRequest(mockStoreRepo(store), mockLedger(0), mockRequestRepo(), mockAccounts()).execute(
      store.id,
      {},
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PayoutNoBankError);
  });

  it("rejects when another request is already open", async () => {
    const store = makeStore();
    const open: PayoutRequestRecord = {
      id: "req-open",
      storeId: store.id,
      amount: 100_000,
      commission: 0,
      balanceBefore: 100_000,
      status: "pending",
      note: null,
      payoutId: null,
      reviewedBy: null,
      reviewedAt: null,
      decisionNote: null,
      createdAt: new Date().toISOString(),
    };
    const result = await new CreatePayoutRequest(
      mockStoreRepo(store),
      mockLedger(0),
      mockRequestRepo(open),
      mockAccounts(),
    ).execute(store.id, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PayoutRequestExistsError);
  });

  it("bypasses KYB and falls back to the master account for whitelisted emails", async () => {
    // Store has NO sub-account and NO kyb status — only a payout bank.
    const store = Store.create({
      ownerId,
      name: "Anna Bakery",
      businessType: BusinessType.Food,
      aestheticPreference: Aesthetic.Warm,
      whatsappNumber: "628123456789",
    }).setPayoutBank({ code: "014", accountNumber: "1234567890", accountName: "Anna" });

    const accounts = mockAccounts({ available: 900_000, balance: 900_000, pending: 100_000, held: 0 });
    const access = { emails: ["asakvsa.idn@gmail.com"], masterAccountId: "master-acc" };

    const result = await new CreatePayoutRequest(
      mockStoreRepo(store),
      mockLedger(0),
      mockRequestRepo(),
      accounts,
      access,
    ).execute(store.id, {}, "asakvsa.idn@gmail.com");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(accounts.checkBalance).toHaveBeenCalledWith("master-acc");
    expect(result.value.request.amount).toBe(900_000);
  });

  it("blocks trial stores from requesting payouts (Pro/Commerce feature)", async () => {
    const store = makeStore();
    const requestRepo = mockRequestRepo();
    const subscriptionRepo = { findActiveByStoreId: vi.fn().mockResolvedValue(null) }; // trial

    const result = await new CreatePayoutRequest(
      mockStoreRepo(store),
      mockLedger(0),
      requestRepo,
      mockAccounts(),
      EMPTY_TEST_ACCESS,
      subscriptionRepo as never,
    ).execute(store.id, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PayoutTierRequiredError);
  });

  it("allows pro stores to request payouts", async () => {
    const store = makeStore();
    const subscriptionRepo = {
      findActiveByStoreId: vi.fn().mockResolvedValue(
        Subscription.create({
          id: createEntityId(),
          storeId: createEntityId(),
          plan: "pro",
          currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        }),
      ),
    };

    const result = await new CreatePayoutRequest(
      mockStoreRepo(store),
      mockLedger(50_000),
      mockRequestRepo(),
      mockAccounts(),
      EMPTY_TEST_ACCESS,
      subscriptionRepo as never,
    ).execute(store.id, {});

    expect(result.ok).toBe(true);
  });

  it("still blocks non-whitelisted users whose store has no sub-account", async () => {
    const store = Store.create({
      ownerId,
      name: "Anna Bakery",
      businessType: BusinessType.Food,
      aestheticPreference: Aesthetic.Warm,
      whatsappNumber: "628123456789",
    }).setPayoutBank({ code: "014", accountNumber: "1234567890", accountName: "Anna" });

    const access = { emails: ["someone-else@gmail.com"], masterAccountId: "master-acc" };
    const result = await new CreatePayoutRequest(
      mockStoreRepo(store),
      mockLedger(0),
      mockRequestRepo(),
      mockAccounts(),
      access,
    ).execute(store.id, {}, "asakvsa.idn@gmail.com");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PayoutNoAccountError);
  });
});

describe("CancelPayoutRequest", () => {
  const base: PayoutRequestRecord = {
    id: "req-1",
    storeId: "",
    amount: 100_000,
    commission: 0,
    balanceBefore: 100_000,
    status: "pending",
    note: null,
    payoutId: null,
    reviewedBy: null,
    reviewedAt: null,
    decisionNote: null,
    createdAt: new Date().toISOString(),
  };

  it("cancels an own pending request", async () => {
    const store = makeStore();
    const request = { ...base, storeId: store.id };
    const requestRepo = mockRequestRepo();
    requestRepo.findById = vi.fn().mockResolvedValue(request);
    const storeRepo = mockStoreRepo(store);

    const result = await new CancelPayoutRequest(requestRepo, storeRepo).execute(request.id, ownerId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request.status).toBe("cancelled");
    expect(requestRepo.update).toHaveBeenCalledWith(request.id, { status: "cancelled" });
  });

  it("forbids cancelling another store's request", async () => {
    const store = makeStore();
    const request = { ...base, storeId: store.id };
    const requestRepo = mockRequestRepo();
    requestRepo.findById = vi.fn().mockResolvedValue(request);
    const otherStore = Store.create({
      ownerId: createEntityId(),
      name: "Other",
      businessType: BusinessType.Food,
      aestheticPreference: Aesthetic.Warm,
      whatsappNumber: "628123456789",
    });
    const storeRepo = mockStoreRepo(otherStore);

    const result = await new CancelPayoutRequest(requestRepo, storeRepo).execute(request.id, ownerId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PayoutRequestNotOwnedError);
  });

  it("forbids cancelling a reviewed request", async () => {
    const store = makeStore();
    const request = { ...base, storeId: store.id, status: "rejected" as const };
    const requestRepo = mockRequestRepo();
    requestRepo.findById = vi.fn().mockResolvedValue(request);

    const result = await new CancelPayoutRequest(requestRepo, mockStoreRepo(store)).execute(request.id, ownerId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PayoutRequestNotReviewableError);
  });
});

describe("ReviewPayoutRequest", () => {
  const base: PayoutRequestRecord = {
    id: "req-1",
    storeId: "",
    amount: 1_200_000,
    commission: 50_000,
    balanceBefore: 1_250_000,
    status: "pending",
    note: null,
    payoutId: null,
    reviewedBy: null,
    reviewedAt: null,
    decisionNote: null,
    createdAt: new Date().toISOString(),
  };

  it("rejects a pending request", async () => {
    const store = makeStore();
    const request = { ...base, storeId: store.id };
    const requestRepo = mockRequestRepo();
    requestRepo.findById = vi.fn().mockResolvedValue(request);

    const result = await new ReviewPayoutRequest(
      requestRepo,
      mockStoreRepo(store),
      mockLedger(),
      mockPayoutRepo(),
      mockAccounts(),
      "settlement-acc",
    ).execute(request.id, { action: "reject", note: "cek dulu", adminId: "admin-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe("rejected");
    expect(result.value.request.status).toBe("rejected");
    expect(result.value.request.decisionNote).toBe("cek dulu");
  });

  it("approves and executes the payout (sweep + disburse)", async () => {
    const store = makeStore();
    const request = { ...base, storeId: store.id };
    const requestRepo = mockRequestRepo();
    requestRepo.findById = vi.fn().mockResolvedValue(request);
    const payoutRepo = mockPayoutRepo();
    const accounts = mockAccounts();

    const result = await new ReviewPayoutRequest(
      requestRepo,
      mockStoreRepo(store),
      mockLedger(50_000),
      payoutRepo,
      accounts,
      "settlement-acc",
    ).execute(request.id, { action: "approve", adminId: "admin-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe("approved");
    expect(result.value.executed).toBe(true);
    expect(result.value.request.status).toBe("paid");
    expect(result.value.request.payoutId).toBe("payout-1");
    expect(accounts.accountTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 50_000, beneficiaryAccountNumber: "settlement-acc" }),
    );
    expect(accounts.disburse).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1_200_000, bankAccountNumber: "1234567890" }),
    );
    expect(payoutRepo.create).toHaveBeenCalled();
    expect(requestRepo.update).toHaveBeenCalledWith(
      request.id,
      expect.objectContaining({ status: "paid", payoutId: "payout-1" }),
    );
  });

  it("keeps the request approved (retryable) when execution fails", async () => {
    const store = makeStore();
    const request = { ...base, storeId: store.id };
    const requestRepo = mockRequestRepo();
    requestRepo.findById = vi.fn().mockResolvedValue(request);
    const accounts = mockAccounts({ available: 10_000, balance: 10_000, pending: 0, held: 0 }); // below commission

    const result = await new ReviewPayoutRequest(
      requestRepo,
      mockStoreRepo(store),
      mockLedger(50_000),
      mockPayoutRepo(),
      accounts,
      "settlement-acc",
    ).execute(request.id, { action: "approve", adminId: "admin-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.executed).toBe(false);
    expect(result.value.error).toBeTruthy();
    expect(result.value.request.status).toBe("approved");
    expect(requestRepo.update).toHaveBeenCalledWith(
      request.id,
      expect.objectContaining({ status: "approved", decisionNote: expect.any(String) }),
    );
  });

  it("skips the commission sweep when nothing is owed (amount 0 rejected by SingaPay)", async () => {
    const store = makeStore();
    const request = { ...base, storeId: store.id, amount: 1_250_000, commission: 0, balanceBefore: 1_250_000 };
    const requestRepo = mockRequestRepo();
    requestRepo.findById = vi.fn().mockResolvedValue(request);
    const payoutRepo = mockPayoutRepo();
    const accounts = mockAccounts({ available: 1_250_000, balance: 1_250_000, pending: 0, held: 0 });

    const result = await new ReviewPayoutRequest(
      requestRepo,
      mockStoreRepo(store),
      mockLedger(0), // commission owed = 0
      payoutRepo,
      accounts,
      "settlement-acc",
    ).execute(request.id, { action: "approve", adminId: "admin-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.executed).toBe(true);
    expect(result.value.request.status).toBe("paid");
    // No sweep with amount 0 — the full available goes to the bank.
    expect(accounts.accountTransfer).not.toHaveBeenCalled();
    expect(accounts.disburse).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1_250_000 }),
    );
    expect(payoutRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ commission: 0, sweepRef: null }),
    );
  });

  it("deducts the quoted transfer fee from the disbursement (gross = net + fee)", async () => {
    const store = makeStore();
    const request = { ...base, storeId: store.id, amount: 1_196_000, commission: 50_000, balanceBefore: 1_250_000 };
    const requestRepo = mockRequestRepo();
    requestRepo.findById = vi.fn().mockResolvedValue(request);
    const payoutRepo = mockPayoutRepo();
    const accounts = mockAccounts({ available: 1_250_000, balance: 1_250_000, pending: 0, held: 0 });
    accounts.checkFee = vi.fn().mockResolvedValue({ transfer_fee: 4000 });

    const result = await new ReviewPayoutRequest(
      requestRepo,
      mockStoreRepo(store),
      mockLedger(50_000),
      payoutRepo,
      accounts,
      "settlement-acc",
    ).execute(request.id, { action: "approve", adminId: "admin-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.executed).toBe(true);
    // available − commission − fee = 1_250_000 − 50_000 − 4_000
    expect(accounts.disburse).toHaveBeenCalledWith(expect.objectContaining({ amount: 1_196_000 }));
    expect(payoutRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1_196_000, commission: 50_000 }),
    );
  });

  it("never marks the request paid when the disbursement was rejected", async () => {
    const store = makeStore();
    const request = { ...base, storeId: store.id, amount: 1_200_000, commission: 50_000, balanceBefore: 1_250_000 };
    const requestRepo = mockRequestRepo();
    requestRepo.findById = vi.fn().mockResolvedValue(request);
    const accounts = mockAccounts({ available: 1_250_000, balance: 1_250_000, pending: 0, held: 0 });
    accounts.disburse = vi.fn().mockResolvedValue({
      transactionId: "mock-dsb-failed",
      referenceNumber: "payout-ref",
      status: "FAILED",
      netAmount: 1_200_000,
      fee: 0,
      failedReason: "ACCOUNT_VALIDATION_ERROR: ACCOUNT INQUIRY FAILED (403)",
    });

    const result = await new ReviewPayoutRequest(
      requestRepo,
      mockStoreRepo(store),
      mockLedger(50_000),
      mockPayoutRepo(),
      accounts,
      "settlement-acc",
    ).execute(request.id, { action: "approve", adminId: "admin-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.executed).toBe(false);
    expect(result.value.error).toContain("ACCOUNT_VALIDATION_ERROR");
    // Request parks back to approved (retryable) — never paid.
    expect(result.value.request.status).toBe("approved");
    expect(requestRepo.update).toHaveBeenCalledWith(
      request.id,
      expect.objectContaining({ status: "approved", decisionNote: expect.stringContaining("ACCOUNT_VALIDATION_ERROR") }),
    );
  });
});
