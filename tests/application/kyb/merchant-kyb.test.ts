import { describe, it, expect, vi } from "vitest";
import {
  StartMerchantKYB,
  GetMerchantKYBStatus,
  KYBStoreNotFoundError,
  KYBProviderUnavailableError,
  type SingaPayAccountsClient,
} from "../../../src/application/kyb/merchant-kyb";
import { Store } from "../../../src/domain/store/store";
import { BusinessType, Aesthetic } from "../../../src/domain/store/types";
import { createEntityId } from "../../../src/domain/shared/types";
import type { StoreRepository } from "../../../src/application/store/store-repo";

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
    listAll: vi.fn().mockResolvedValue({ stores: [], total: 0 }),
    countAll: vi.fn().mockResolvedValue({ total: 0, published: 0, draft: 0, suspended: 0 }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function mockAccounts(overrides?: Partial<SingaPayAccountsClient>): SingaPayAccountsClient {
  return {
    createSubAccount: vi.fn().mockResolvedValue({
      id: "01KYBTESTACCOUNT000000000000",
      name: "Anna Bakery",
      status: "inactive",
      account_type: "personal_managed",
      kyb_status: "kyb_in_review",
      kyb_onboarding_url: "https://kyb.singapay.id/anna-bakery",
    }),
    getAccount: vi.fn().mockResolvedValue({
      id: "01KYBTESTACCOUNT000000000000",
      name: "Anna Bakery",
      status: "inactive",
      account_type: "personal_managed",
      kyb_status: "kyb_in_review",
      kyb_onboarding_url: "https://kyb.singapay.id/anna-bakery",
    }),
    ...overrides,
  };
}

describe("StartMerchantKYB", () => {
  it("creates a managed sub-account on first start and persists it on the store", async () => {
    const store = makeStore();
    const storeRepo = mockStoreRepo();
    storeRepo.findById.mockResolvedValue(store);
    const accounts = mockAccounts();

    const result = await new StartMerchantKYB(storeRepo, accounts).execute(store.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kybStatus).toBe("kyb_in_review");
    expect(result.value.kybOnboardingUrl).toContain("kyb.singapay.id");
    expect(accounts.createSubAccount).toHaveBeenCalledWith({
      name: "Anna Bakery",
      accountType: "personal_managed",
    });
    expect(store.singapayAccountId).toBe("01KYBTESTACCOUNT000000000000");
    expect(store.kybStatus).toBe("kyb_in_review");
    expect(storeRepo.save).toHaveBeenCalledWith(store);
  });

  it("re-fetches the existing account (resume) instead of creating a second one", async () => {
    const store = makeStore();
    store.updatePaymentProviderAccount("01KYBTESTACCOUNT000000000000", "kyb_in_review");
    const storeRepo = mockStoreRepo();
    storeRepo.findById.mockResolvedValue(store);
    const accounts = mockAccounts();

    const result = await new StartMerchantKYB(storeRepo, accounts).execute(store.id);

    expect(result.ok).toBe(true);
    expect(accounts.createSubAccount).not.toHaveBeenCalled();
    expect(accounts.getAccount).toHaveBeenCalledWith("01KYBTESTACCOUNT000000000000");
  });

  it("returns STORE_NOT_FOUND for an unknown store", async () => {
    const storeRepo = mockStoreRepo();
    storeRepo.findById.mockResolvedValue(null);
    const result = await new StartMerchantKYB(storeRepo, mockAccounts()).execute(createEntityId());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(KYBStoreNotFoundError);
  });

  it("wraps provider failures as KYB_UNAVAILABLE", async () => {
    const store = makeStore();
    const storeRepo = mockStoreRepo();
    storeRepo.findById.mockResolvedValue(store);
    const accounts = mockAccounts({ createSubAccount: vi.fn().mockRejectedValue(new Error("boom")) });

    const result = await new StartMerchantKYB(storeRepo, accounts).execute(store.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(KYBProviderUnavailableError);
  });
});

describe("GetMerchantKYBStatus", () => {
  it("reports none when the store has no sub-account yet", async () => {
    const store = makeStore();
    const storeRepo = mockStoreRepo();
    storeRepo.findById.mockResolvedValue(store);

    const result = await new GetMerchantKYBStatus(storeRepo, mockAccounts()).execute(store.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kybStatus).toBe("none");
  });

  it("caches a verified status on the store", async () => {
    const store = makeStore();
    store.updatePaymentProviderAccount("01KYBTESTACCOUNT000000000000", "kyb_in_review");
    const storeRepo = mockStoreRepo();
    storeRepo.findById.mockResolvedValue(store);
    const accounts = mockAccounts({
      getAccount: vi.fn().mockResolvedValue({
        id: "01KYBTESTACCOUNT000000000000",
        name: "Anna Bakery",
        status: "active",
        account_type: "personal_managed",
        kyb_status: "kyb_verified",
        kyb_onboarding_url: null,
        legal_name: "Anna Maria",
        brand_name: "Anna Bakery",
      }),
    });

    const result = await new GetMerchantKYBStatus(storeRepo, accounts).execute(store.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kybStatus).toBe("kyb_verified");
    expect(result.value.legalName).toBe("Anna Maria");
    expect(store.kybStatus).toBe("kyb_verified");
    expect(storeRepo.save).toHaveBeenCalled();
  });
});
