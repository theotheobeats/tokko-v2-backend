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
import type { NormalizedSingaPayDisbursementWebhook } from "../../infrastructure/payments/singapay-webhook";
import { EMPTY_TEST_ACCESS, isTestEmail, type TestAccess } from "../payout/test-access";

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
export class PayoutNotFoundError extends Error {
  code = "PAYOUT_NOT_FOUND";
  constructor() { super("Pencairan tidak ditemukan."); }
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

/** Whether a national bank code is in the supported set. */
export function isSupportedBankCode(code: string | null | undefined): boolean {
  return !!code && Object.values(ID_BANK_CODES).includes(code);
}

/** Bank name for a national code (reverse lookup, first match). */
export function bankNameFor(code: string | null | undefined): string | null {
  if (!code) return null;
  const entry = Object.entries(ID_BANK_CODES).find(([, c]) => c === code);
  return entry?.[0] ?? null;
}

/** SWIFT/BIC per national code — needed by check-beneficiary (v1). */
const BANK_SWIFT: Record<string, string> = {
  "014": "CENAIDJA", // BCA
  "008": "BMRIIDJA", // Mandiri
  "009": "BNINIDJA", // BNI
  "002": "BRINIDJA", // BRI
  "200": "BTANIDJA", // BTN
  "013": "BBBAIDJA", // Permata
  "022": "BNIAIDJA", // CIMB Niaga
  "011": "BDINIDJA", // Danamon
  "016": "IBBEIDJA", // Maybank
  "451": "BSMSIDJA", // BSI
  "028": "NISPIDJA", // OCBC NISP
  "213": "BTPSIDJA", // BTPN
};

/** SWIFT for a national code; null for digital banks (no SWIFT). */
export function swiftCodeFor(bankCode: string | null | undefined): string | null {
  return bankCode ? (BANK_SWIFT[bankCode] ?? null) : null;
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
    /** Test access (KYB bypass + master-account balance fallback). */
    private readonly testAccess: TestAccess = EMPTY_TEST_ACCESS,
  ) {}

  async execute(storeId: EntityId, ownerEmail?: string): Promise<Result<PayoutSummaryView, PayoutStoreNotFoundError | PayoutProviderError>> {
    const store = await this.storeRepo.findById(storeId);
    if (!store) return err(new PayoutStoreNotFoundError());

    const isTest = isTestEmail(ownerEmail, this.testAccess);
    const effectiveKyb = store.kybStatus === "kyb_verified" || isTest ? "kyb_verified" : store.kybStatus;
    // Test stores without a sub-account read the master account (balance + settlements).
    const accountId = store.singapayAccountId ?? (isTest ? this.testAccess.masterAccountId : null);

    let balance: SingaPayBalance = { available: 0, balance: 0, pending: 0, held: 0 };
    if (accountId) {
      try {
        balance = await this.accounts.checkBalance(accountId);
      } catch (e) {
        return err(new PayoutProviderError(e instanceof Error ? e.message : "Gagal membaca saldo."));
      }
    }
    const commissionOwed = await this.ledger.sumByStoreId(store.id);
    // Prefer the dedicated payout bank; fall back to the manual-transfer bank.
    const bankCode = store.payoutBankCode ?? bankCodeFor(store.bankName);
    const accountNumber = store.payoutBankAccountNumber ?? store.bankAccountNumber;
    const accountName = store.payoutBankAccountName ?? store.bankAccountName;
    const bankName = bankNameFor(bankCode) ?? store.bankName;

    return ok({
      storeId: store.id,
      storeName: store.name,
      subdomain: store.subdomain,
      subAccountId: accountId,
      kybStatus: effectiveKyb,
      balance,
      commissionOwed,
      payoutBank: accountNumber
        ? { name: bankName, accountNumber, holder: accountName }
        : null,
      bankCode,
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
    /** Test access (KYB bypass + master-account fallback). */
    private readonly testAccess: TestAccess = EMPTY_TEST_ACCESS,
  ) {}

  async execute(storeId: EntityId, ownerEmail?: string): Promise<Result<PayoutResult, Error>> {
    const store = await this.storeRepo.findById(storeId);
    if (!store) return err(new PayoutStoreNotFoundError());

    const isTest = isTestEmail(ownerEmail, this.testAccess);
    const accountId = store.singapayAccountId ?? (isTest ? this.testAccess.masterAccountId : null);
    if (!accountId) return err(new PayoutNoAccountError());
    if (store.kybStatus !== "kyb_verified" && !isTest) return err(new PayoutKYBNotVerifiedError());
    // Prefer the dedicated payout bank; fall back to the manual-transfer bank.
    const bankCode = store.payoutBankCode ?? bankCodeFor(store.bankName) ?? "";
    const bankAccountNumber = store.payoutBankAccountNumber ?? store.bankAccountNumber ?? "";
    if (!bankAccountNumber) return err(new PayoutNoBankError());
    if (!isSupportedBankCode(bankCode)) return err(new PayoutBankUnsupportedError());

    let balance: SingaPayBalance;
    try {
      balance = await this.accounts.checkBalance(accountId);
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
        accountId,
        amount: commission,
        beneficiaryAccountNumber: this.settlementAccountNumber,
        merchantRefNo: `${ref}-commission`,
      });

      // 2. Disburse the remainder → merchant bank.
      const disb = await this.accounts.disburse({
        accountId,
        referenceNumber: ref,
        bankCode,
        bankAccountNumber,
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

/**
 * Disbursement notification (SingaPay → us, `disbursement_notif_url`).
 *
 * Money-out results arrive asynchronously AFTER the transfer was submitted:
 * this use case flips the payout from `submitted` to `settled` (code "00" /
 * SP000) or `failed` (code "06" / SP001, with failed_reason). Idempotent —
 * a settled payout is terminal; repeated/late notifications are no-ops.
 */
export class HandleDisbursementWebhook {
  constructor(private readonly payoutRepo: PayoutRepository) {}

  async execute(
    input: NormalizedSingaPayDisbursementWebhook,
  ): Promise<Result<{ handled: boolean }, PayoutNotFoundError>> {
    const payout = await this.payoutRepo.findByRef(input.referenceNumber);
    if (!payout) return err(new PayoutNotFoundError());

    // Already terminal (settled, or failed with a recorded reason) — ignore.
    if (payout.status !== "submitted") return ok({ handled: false });

    await this.payoutRepo.updateStatus(payout.id, {
      status: input.status === "failed" ? "failed" : "settled",
      providerTransactionId: input.transactionId,
      failedReason: input.failedReason,
    });
    return ok({ handled: true });
  }
}
