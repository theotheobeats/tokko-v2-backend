/**
 * Merchant KYB — managed sub-account lifecycle (SingaPay BOSS KYB).
 *
 * Each merchant that enables online checkout gets their own managed
 * sub-account (`personal_managed`/`business_managed`) under our platform
 * account. The sub-account is created `inactive` with a public self-onboarding
 * `kyb_onboarding_url`; once BOSS approves, `kyb_status` becomes
 * `kyb_verified` and the merchant's order payments settle into THEIR account
 * (we never hold merchant money). KYB status is polled — SingaPay has no KYB
 * webhook.
 */

import type { Result } from "../../domain/shared/types";
import { ok, err, type EntityId } from "../../domain/shared/types";
import type { StoreRepository } from "../store/store-repo";
import type { SingaPayAccount } from "../../infrastructure/payments/singapay-client";

export class KYBStoreNotFoundError extends Error {
  code = "STORE_NOT_FOUND";
  constructor() { super("Toko tidak ditemukan"); }
}

export class KYBProviderUnavailableError extends Error {
  code = "KYB_UNAVAILABLE";
  constructor() { super("Verifikasi merchant belum tersedia saat ini."); }
}

/** Managed account type for UMKM merchants (individual sellers). */
export const KYB_ACCOUNT_TYPE = "personal_managed" as const;

export interface MerchantKYBView {
  kybStatus: "none" | "kyb_in_review" | "kyb_verified";
  accountStatus: string | null;
  kybOnboardingUrl: string | null;
  legalName: string | null;
  brandName: string | null;
}

export interface SingaPayAccountsClient {
  createSubAccount(input: {
    name: string;
    accountType: "personal_managed" | "business_managed";
  }): Promise<SingaPayAccount>;
  getAccount(accountId: string): Promise<SingaPayAccount>;
}

function toView(account: SingaPayAccount | null): MerchantKYBView {
  if (!account) {
    return { kybStatus: "none", accountStatus: null, kybOnboardingUrl: null, legalName: null, brandName: null };
  }
  const kyb = account.kyb_status === "kyb_verified" || account.kyb_status === "kyb_in_review"
    ? account.kyb_status
    : "none";
  return {
    kybStatus: kyb,
    accountStatus: account.status ?? null,
    kybOnboardingUrl: account.kyb_onboarding_url ?? null,
    legalName: account.legal_name ?? null,
    brandName: account.brand_name ?? null,
  };
}

/** Start (or resume) the merchant KYB flow: create the managed sub-account once. */
export class StartMerchantKYB {
  constructor(
    private readonly storeRepo: StoreRepository,
    private readonly accounts: SingaPayAccountsClient,
  ) {}

  async execute(storeId: EntityId): Promise<Result<MerchantKYBView, KYBStoreNotFoundError | KYBProviderUnavailableError>> {
    const store = await this.storeRepo.findById(storeId);
    if (!store) return err(new KYBStoreNotFoundError());

    try {
      if (!store.singapayAccountId) {
        const account = await this.accounts.createSubAccount({
          name: store.name,
          accountType: KYB_ACCOUNT_TYPE,
        });
        store.updatePaymentProviderAccount(account.id, account.kyb_status ?? "kyb_in_review");
        await this.storeRepo.save(store);
        return ok(toView(account));
      }

      // Account exists — re-fetch to get the current active onboarding link + status.
      const account = await this.accounts.getAccount(store.singapayAccountId);
      if (account.kyb_status && account.kyb_status !== store.kybStatus) {
        store.updatePaymentProviderAccount(store.singapayAccountId, account.kyb_status);
        await this.storeRepo.save(store);
      }
      return ok(toView(account));
    } catch (e) {
      if (e instanceof KYBStoreNotFoundError) throw e;
      return err(new KYBProviderUnavailableError());
    }
  }
}

/** Read the current KYB status (live from the provider; caches on the store). */
export class GetMerchantKYBStatus {
  constructor(
    private readonly storeRepo: StoreRepository,
    private readonly accounts: SingaPayAccountsClient,
  ) {}

  async execute(storeId: EntityId): Promise<Result<MerchantKYBView, KYBStoreNotFoundError | KYBProviderUnavailableError>> {
    const store = await this.storeRepo.findById(storeId);
    if (!store) return err(new KYBStoreNotFoundError());
    if (!store.singapayAccountId) return ok(toView(null));

    try {
      const account = await this.accounts.getAccount(store.singapayAccountId);
      if (account.kyb_status && account.kyb_status !== store.kybStatus) {
        store.updatePaymentProviderAccount(store.singapayAccountId, account.kyb_status);
        await this.storeRepo.save(store);
      }
      return ok(toView(account));
    } catch {
      return err(new KYBProviderUnavailableError());
    }
  }
}
