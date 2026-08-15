import { describe, it, expect, vi } from "vitest";
import {
  GetPayoutSummary,
  RunPayout,
  bankCodeFor,
  PayoutNoBankError,
  PayoutBankUnsupportedError,
  PayoutInsufficientBalanceError,
  PayoutKYBNotVerifiedError,
  PayoutProviderError,
} from "../../../src/application/admin/admin-payouts";
import { Store } from "../../../src/domain/store/store";
import { BusinessType, Aesthetic } from "../../../src/domain/store/types";
import { createEntityId } from "../../../src/domain/shared/types";
import type { StoreRepository } from "../../../src/application/store/store-repo";
import type { CommissionLedger } from "../../../src/infrastructure/repos/d1-commission-ledger";
import type { PayoutRepository } from "../../../src/infrastructure/repos/d1-payout-repo";
import type { SingaPayAccountsClientLike } from "../../../src/infrastructure/payments/singapay-client";

const ownerId = createEntityId();

function makeStore() {
  return Store.create({
    ownerId,
    name: "Anna Bakery",
    businessType: BusinessType.Food,
    aestheticPreference: Aesthetic.Warm,
    whatsappNumber: "628123456789",
  });
}

function mockStoreRepo(): StoreRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findBySubdomain: vi.fn().mockResolvedValue(null),
    findByOwnerId: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    countProducts: vi.fn().mockResolvedValue(0),
    countPhysicalProductsMissingShipping: vi.fn().mockResolvedValue(0),
    countPhysicalProducts: vi.fn().mockResolvedValue(1),
    listAll: vi.fn().mockResolvedValue({ stores: [], total: 0 }),
    countAll: vi.fn().mockResolvedValue({ total: 0, published: 0, draft: 0, suspended: 0 }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function mockLedger(commission = 0): CommissionLedger {
  return { record: vi.fn().mockResolvedValue(undefined), sumByStoreId: vi.fn().mockResolvedValue(commission) };
}

function mockPayoutRepo(): PayoutRepository {
  return {
    create: vi.fn().mockImplementation(async (input) => ({ ...input, id: "payout-1", createdAt: "2026-08-12T00:00:00Z" })),
    list: vi.fn().mockResolvedValue({ payouts: [], total: 0 }),
    findByRef: vi.fn().mockResolvedValue(null),
    updateStatus: vi.fn().mockResolvedValue(undefined),
  };
}

function mockAccounts(overrides?: Partial<SingaPayAccountsClientLike>): SingaPayAccountsClientLike {
  return {
    createSubAccount: vi.fn(),
    getAccount: vi.fn(),
    listPaymentMethods: vi.fn(),
    checkBalance: vi.fn().mockResolvedValue({ available: 2_000_000, balance: 2_000_000, pending: 0, held: 0 }),
    checkFee: vi.fn(),
    checkBeneficiary: vi.fn(),
    disburse: vi.fn().mockResolvedValue({
      transactionId: "dsb-1",
      referenceNumber: "payout-ref-1",
      status: "SUCCESS",
      netAmount: 1_000_000,
      fee: 4000,
      failedReason: null,
    }),
    accountTransfer: vi.fn().mockResolvedValue({ transactionId: "at-1", status: "success" }),
    ...overrides,
  };
}

describe("bankCodeFor", () => {
  it("maps common Indonesian banks to national codes", () => {
    expect(bankCodeFor("BCA")).toBe("014");
    expect(bankCodeFor("mandiri")).toBe("008");
    expect(bankCodeFor("BNI")).toBe("009");
    expect(bankCodeFor("BRI")).toBe("002");
    expect(bankCodeFor("CIMB Niaga")).toBe("022");
    expect(bankCodeFor(null)).toBeNull();
    expect(bankCodeFor("Bank Aneh")).toBeNull();
  });
});

describe("GetPayoutSummary", () => {
  it("returns a zero-balance view when the store has no sub-account", async () => {
    const store = makeStore();
    const storeRepo = mockStoreRepo();
    storeRepo.findById.mockResolvedValue(store);
    const result = await new GetPayoutSummary(storeRepo, mockLedger(), mockAccounts()).execute(store.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.balance.available).toBe(0);
      expect(result.value.subAccountId).toBeNull();
    }
  });

  it("reads the live balance + accrued commission", async () => {
    const store = makeStore();
    store.updatePaymentProviderAccount("01KYBTESTACCOUNT000000000000", "kyb_verified");
    const storeRepo = mockStoreRepo();
    storeRepo.findById.mockResolvedValue(store);
    const result = await new GetPayoutSummary(storeRepo, mockLedger(120_000), mockAccounts()).execute(store.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.balance.available).toBe(2_000_000);
      expect(result.value.commissionOwed).toBe(120_000);
    }
  });
});

describe("RunPayout", () => {
  it("sweeps commission then disburses the remainder (happy path)", async () => {
    const store = makeStore();
    store.updatePaymentProviderAccount("01KYBTESTACCOUNT000000000000", "kyb_verified");
    store.updatePaymentConfig({ paymentOnline: true, bankName: "BCA", bankAccountNumber: "1234567890", bankAccountName: "Anna" } as never);
    const storeRepo = mockStoreRepo();
    storeRepo.findById.mockResolvedValue(store);
    const accounts = mockAccounts();
    const payoutRepo = mockPayoutRepo();

    const result = await new RunPayout(storeRepo, mockLedger(500_000), payoutRepo, accounts, "282011142578").execute(store.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // sweep 500k to settlement, disburse 1.5M to the merchant bank
    expect(accounts.accountTransfer).toHaveBeenCalledWith({
      accountId: "01KYBTESTACCOUNT000000000000",
      amount: 500_000,
      beneficiaryAccountNumber: "282011142578",
      merchantRefNo: expect.stringContaining("commission"),
    });
    expect(accounts.disburse).toHaveBeenCalledWith(
      expect.objectContaining({ bankCode: "014", bankAccountNumber: "1234567890", amount: 1_500_000 }),
    );
    expect(result.value.payout.amount).toBe(1_500_000);
    expect(result.value.payout.commission).toBe(500_000);
    expect(payoutRepo.create).toHaveBeenCalled();
  });

  it("blocks payouts before KYB is verified", async () => {
    const store = makeStore();
    store.updatePaymentProviderAccount("01KYBTESTACCOUNT000000000000", "kyb_in_review");
    const storeRepo = mockStoreRepo();
    storeRepo.findById.mockResolvedValue(store);
    const result = await new RunPayout(storeRepo, mockLedger(), mockPayoutRepo(), mockAccounts(), "x").execute(store.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(PayoutKYBNotVerifiedError);
  });

  it("requires a bank account and a supported bank", async () => {
    const store = makeStore();
    store.updatePaymentProviderAccount("01KYBTESTACCOUNT000000000000", "kyb_verified");
    const storeRepo = mockStoreRepo();
    storeRepo.findById.mockResolvedValue(store);

    // no bank
    let result = await new RunPayout(storeRepo, mockLedger(), mockPayoutRepo(), mockAccounts(), "x").execute(store.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(PayoutNoBankError);

    // unsupported bank
    store.updatePaymentConfig({ bankName: "Bank Aneh", bankAccountNumber: "123" } as never);
    result = await new RunPayout(storeRepo, mockLedger(), mockPayoutRepo(), mockAccounts(), "x").execute(store.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(PayoutBankUnsupportedError);
  });

  it("refuses when the balance cannot cover commission + payout", async () => {
    const store = makeStore();
    store.updatePaymentProviderAccount("01KYBTESTACCOUNT000000000000", "kyb_verified");
    store.updatePaymentConfig({ bankName: "BCA", bankAccountNumber: "1234567890" } as never);
    const storeRepo = mockStoreRepo();
    storeRepo.findById.mockResolvedValue(store);
    const accounts = mockAccounts({ checkBalance: vi.fn().mockResolvedValue({ available: 100_000, balance: 100_000, pending: 0, held: 0 }) });
    const result = await new RunPayout(storeRepo, mockLedger(500_000), mockPayoutRepo(), accounts, "x").execute(store.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(PayoutInsufficientBalanceError);
  });

  it("prefers the dedicated payout bank over the manual-transfer bank", async () => {
    const store = makeStore();
    store.updatePaymentProviderAccount("01KYBTESTACCOUNT000000000000", "kyb_verified");
    store.setPayoutBank({ code: "008", accountNumber: "9876543210", accountName: "Anna" });
    const storeRepo = mockStoreRepo();
    storeRepo.findById.mockResolvedValue(store);
    const accounts = mockAccounts();

    const result = await new RunPayout(storeRepo, mockLedger(100_000), mockPayoutRepo(), accounts, "x").execute(store.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(accounts.disburse).toHaveBeenCalledWith(expect.objectContaining({ bankCode: "008", bankAccountNumber: "9876543210" }));
    }
  });

  it("wraps provider failures", async () => {
    const store = makeStore();
    store.updatePaymentProviderAccount("01KYBTESTACCOUNT000000000000", "kyb_verified");
    store.updatePaymentConfig({ bankName: "BCA", bankAccountNumber: "1234567890" } as never);
    const storeRepo = mockStoreRepo();
    storeRepo.findById.mockResolvedValue(store);
    const accounts = mockAccounts({ disburse: vi.fn().mockRejectedValue(new Error("singapay down")) });
    const result = await new RunPayout(storeRepo, mockLedger(), mockPayoutRepo(), accounts, "x").execute(store.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(PayoutProviderError);
  });
});
