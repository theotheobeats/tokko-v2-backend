/**
 * Merchant payouts (SingaPay) — admin-driven.
 *
 * Money lives in the merchant's OWN SingaPay sub-account. A payout:
 *   1. sweeps accrued platform commission → our settlement account
 *      (account-transfer, so we never hold merchant money),
 *   2. disburses the remaining available balance → the merchant's bank
 *      (signed money-out with an idempotent reference_number).
 *
 * Both moves are recorded in the `payouts` table for history + audit.
 */

import type { Result } from "../../domain/shared/types";
import { ok, err, type EntityId } from "../../domain/shared/types";
import type { StoreRepository } from "../store/store-repo";
import type { CommissionLedger } from "../../infrastructure/repos/d1-commission-ledger";
import type { PayoutRepository } from "../../infrastructure/repos/d1-payout-repo";
import type { SingaPayAccountsClientLike, SingaPayBalance } from "../../infrastructure/payments/singapay-client";

export class PayoutStoreNotFoundError extends Error {
  code = "STORE_NOT_FOUND";
  constructor() { super("Toko tidak ditemukan"); }
}
export class PayoutNoAccountError extends Error {
  code = "PAYOUT_NO_ACCOUNT";
  constructor() { super("Merchant belum memiliki akun pembayaran SingaPay."); }
}
export class PayoutKYBNotVerifiedError extends Error {
  code = "KYB_NOT_VERIFIED";
  constructor() { super("Verifikasi merchant (KYB) belum selesai."); }
}
export class PayoutNoBankError extends Error {
  code = "PAYOUT_BANK_MISSING";
  constructor() { super("Merchant belum melengkapi rekening bank tujuan."); }
}
export class PayoutBankUnsupportedError extends Error {
  code = "PAYOUT_BANK_UNSUPPORTED";
  constructor() { super("Bank tidak didukung untuk pencairan — gunakan BCA, Mandiri, BNI, BRI, atau bank yang terdaftar."); }
}
export class PayoutInsufficientBalanceError extends Error {
  code = "PAYOUT_INSUFFICIENT_BALANCE";
  constructor() { super("Saldo tidak cukup untuk komisi + pencairan."); }
}
export class PayoutProviderError extends Error {
  code = "PAYOUT_PROVIDER_ERROR";
  constructor(message: string) { super(message); }
}

/** National bank codes accepted by the SingaPay v2 disbursement. */
const ID_BANK_CODES: Record<string, string> = {
  BCA: "014",
  MANDIRI: "008",
  BNI: "009",
  BRI: "002",
  BTN: "200",
  PERMATA: "013",
  "CIMB NIAGA": "022",
  CIMB: "022",
  DANAMON: "011",
  MAYBANK: "016",
  BSI: "451",
  "BANK SYARIAH INDONESIA": "451",
  OCBC: "028",
  BTPN: "213",
  "BANK JAGO": "542",
  SEABANK: "531",
  "JAGO": "542",
};

export function bankCodeFor(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = name.trim().toUpperCase().replace(/\s+/g, " ");
  return ID_BANK_CODES[key] ?? null;
}

export interface PayoutSummaryView {
  storeId: string;
  storeName: string;
  subdomain: string;
  subAccountId: string | null;
  kybStatus: string | null;
  balance: { available: number; balance: number; pending: number; held: number };
  commissionOwed: number;
  payoutBank: { name: string | null; accountNumber: string | null; holder: string | null } | null;
  bankCode: string | null;
}

export class GetPayoutSummary {
  constructor(
    private readonly storeRepo: StoreRepository,
    private readonly ledger: CommissionLedger,
    private readonly accounts: SingaPayAccountsClientLike,
  ) {}

  async execute(storeId: EntityId): Promise<Result<PayoutSummaryView, PayoutStoreNotFoundError | PayoutProviderError>> {
    const store = await this.storeRepo.findById(storeId);
    if (!store) return err(new PayoutStoreNotFoundError());

    let balance: SingaPayBalance = { available: 0, balance: 0, pending: 0, held: 0 };
    if (store.singapayAccountId) {
      try {
        balance = await this.accounts.checkBalance(store.singapayAccountId);
      } catch (e) {
        return err(new PayoutProviderError(e instanceof Error ? e.message : "Gagal membaca saldo."));
      }
    }
    const commissionOwed = await this.ledger.sumByStoreId(store.id);

    return ok({
      storeId: store.id,
      storeName: store.name,
      subdomain: store.subdomain,
      subAccountId: store.singapayAccountId,
      kybStatus: store.kybStatus,
      balance,
      commissionOwed,
      payoutBank: store.bankAccountNumber
        ? { name: store.bankName, accountNumber: store.bankAccountNumber, holder: store.bankAccountName }
        : null,
      bankCode: bankCodeFor(store.bankName),
    });
  }
}

export interface PayoutResult {
  payout: {
    id: string;
    amount: number;
    commission: number;
    balanceBefore: number;
    sweepRef: string | null;
    payoutRef: string | null;
    providerTransactionId: string | null;
    status: string;
    failedReason: string | null;
  };
  disbursement: { transactionId: string; referenceNumber: string; status: string; netAmount: number; fee: number; failedReason: string | null };
}

export class RunPayout {
  constructor(
    private readonly storeRepo: StoreRepository,
    private readonly ledger: CommissionLedger,
    private readonly payoutRepo: PayoutRepository,
    private readonly accounts: SingaPayAccountsClientLike,
    /** Our platform settlement account number (commission sweep beneficiary). */
    private readonly settlementAccountNumber: string,
  ) {}

  async execute(storeId: EntityId): Promise<Result<PayoutResult, Error>> {
    const store = await this.storeRepo.findById(storeId);
    if (!store) return err(new PayoutStoreNotFoundError());
    if (!store.singapayAccountId) return err(new PayoutNoAccountError());
    if (store.kybStatus !== "kyb_verified") return err(new PayoutKYBNotVerifiedError());
    if (!store.bankAccountNumber) return err(new PayoutNoBankError());
    const bankCode = bankCodeFor(store.bankName);
    if (!bankCode) return err(new PayoutBankUnsupportedError());

    let balance: SingaPayBalance;
    try {
      balance = await this.accounts.checkBalance(store.singapayAccountId);
    } catch (e) {
      return err(new PayoutProviderError(e instanceof Error ? e.message : "Gagal membaca saldo."));
    }

    const commission = await this.ledger.sumByStoreId(store.id);
    const payoutAmount = balance.available - commission;
    if (payoutAmount <= 0) return err(new PayoutInsufficientBalanceError());

    const ref = `payout-${store.id.slice(0, 8)}-${Date.now()}`;

    try {
      // 1. Sweep platform commission → our settlement account.
      const sweep = await this.accounts.accountTransfer({
        accountId: store.singapayAccountId,
        amount: commission,
        beneficiaryAccountNumber: this.settlementAccountNumber,
        merchantRefNo: `${ref}-commission`,
      });

      // 2. Disburse the remainder → merchant bank.
      const disb = await this.accounts.disburse({
        accountId: store.singapayAccountId,
        referenceNumber: ref,
        bankCode,
        bankAccountNumber: store.bankAccountNumber,
        amount: payoutAmount,
        notes: `Pencairan Tokko — ${store.name}`,
      });

      const record = await this.payoutRepo.create({
        storeId: store.id,
        amount: payoutAmount,
        commission,
        balanceBefore: balance.available,
        sweepRef: sweep.transactionId,
        payoutRef: disb.referenceNumber,
        providerTransactionId: disb.transactionId,
        status: disb.status === "FAILED" ? "failed" : "submitted",
        failedReason: disb.failedReason,
      });

      return ok({
        payout: { ...record },
        disbursement: disb,
      });
    } catch (e) {
      return err(new PayoutProviderError(e instanceof Error ? e.message : "Pencairan gagal."));
    }
  }
}
