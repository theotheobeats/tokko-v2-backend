/**
 * Merchant-initiated payout requests (SingaPay) — admin-approved.
 *
 * Merchants request a pencairan of their ready funds: live available balance
 * minus accrued platform commission. The request is a snapshot + intent; the
 * actual money movement (commission sweep + bank disbursement) only happens
 * when an admin approves it (ReviewPayoutRequest → RunPayout). This keeps the
 * "only platform operators move money" rule while giving merchants a
 * self-serve request flow we can automate later if the flow proves stable.
 */

import type { Result } from "../../domain/shared/types";
import { ok, err, type EntityId } from "../../domain/shared/types";
import type { StoreRepository } from "../store/store-repo";
import type { CommissionLedger } from "../../infrastructure/repos/d1-commission-ledger";
import type {
  PayoutRequestRepository,
  PayoutRequestRecord,
  PayoutRequestStatus,
} from "../../infrastructure/repos/d1-payout-request-repo";
import type { PayoutRepository } from "../../infrastructure/repos/d1-payout-repo";
import type { SingaPayAccountsClientLike, SingaPayBalance } from "../../infrastructure/payments/singapay-client";
import {
  PayoutStoreNotFoundError,
  PayoutNoAccountError,
  PayoutKYBNotVerifiedError,
  PayoutNoBankError,
  PayoutBankUnsupportedError,
  PayoutInsufficientBalanceError,
  PayoutProviderError,
  bankCodeFor,
  isSupportedBankCode,
  RunPayout,
  type PayoutResult,
} from "../admin/admin-payouts";

// Re-exported so routes map them to HTTP codes without touching admin-payouts.
export {
  PayoutStoreNotFoundError,
  PayoutNoAccountError,
  PayoutKYBNotVerifiedError,
  PayoutNoBankError,
  PayoutBankUnsupportedError,
  PayoutInsufficientBalanceError,
  PayoutProviderError,
} from "../admin/admin-payouts";

export class PayoutRequestExistsError extends Error {
  code = "PAYOUT_REQUEST_EXISTS";
  constructor() { super("Sudah ada permintaan pencairan yang menunggu persetujuan."); }
}
export class PayoutRequestInvalidAmountError extends Error {
  code = "PAYOUT_REQUEST_INVALID_AMOUNT";
  constructor(message: string) { super(message); }
}
export class PayoutRequestNotFoundError extends Error {
  code = "PAYOUT_REQUEST_NOT_FOUND";
  constructor() { super("Permintaan pencairan tidak ditemukan."); }
}
export class PayoutRequestNotOwnedError extends Error {
  code = "PAYOUT_REQUEST_NOT_OWNED";
  constructor() { super("Permintaan pencairan bukan milik toko ini."); }
}
export class PayoutRequestNotReviewableError extends Error {
  code = "PAYOUT_REQUEST_NOT_REVIEWABLE";
  constructor() { super("Permintaan pencairan sudah diproses."); }
}

/** SingaPay's minimum disbursement amount (docs: Send Money → Bank Coverage). */
const MIN_PAYOUT_AMOUNT = 10_000;

export interface CreatePayoutRequestInput {
  amount?: number;
  note?: string;
}

export class CreatePayoutRequest {
  constructor(
    private readonly storeRepo: StoreRepository,
    private readonly ledger: CommissionLedger,
    private readonly requestRepo: PayoutRequestRepository,
    private readonly accounts: SingaPayAccountsClientLike,
  ) {}

  async execute(
    storeId: EntityId,
    input: CreatePayoutRequestInput,
  ): Promise<
    Result<
      { request: PayoutRequestRecord; readyToPayout: number },
      Error
    >
  > {
    const store = await this.storeRepo.findById(storeId);
    if (!store) return err(new PayoutStoreNotFoundError());
    if (!store.singapayAccountId) return err(new PayoutNoAccountError());
    if (store.kybStatus !== "kyb_verified") return err(new PayoutKYBNotVerifiedError());

    const bankCode = store.payoutBankCode ?? bankCodeFor(store.bankName) ?? "";
    const bankAccountNumber = store.payoutBankAccountNumber ?? store.bankAccountNumber ?? "";
    if (!bankAccountNumber) return err(new PayoutNoBankError());
    if (!isSupportedBankCode(bankCode)) return err(new PayoutBankUnsupportedError());

    let balance: SingaPayBalance;
    try {
      balance = await this.accounts.checkBalance(store.singapayAccountId);
    } catch (e) {
      return err(new PayoutProviderError(e instanceof Error ? e.message : "Gagal membaca saldo."));
    }

    const commission = await this.ledger.sumByStoreId(store.id);
    const readyToPayout = balance.available - commission;
    const amount = input.amount ?? readyToPayout;

    if (readyToPayout <= 0) return err(new PayoutInsufficientBalanceError());
    if (amount < MIN_PAYOUT_AMOUNT) {
      return err(new PayoutRequestInvalidAmountError(`Jumlah pencairan minimal Rp ${MIN_PAYOUT_AMOUNT.toLocaleString("id-ID")}.`));
    }
    if (amount > readyToPayout) {
      return err(new PayoutRequestInvalidAmountError("Jumlah melebihi saldo siap cair."));
    }

    const open = await this.requestRepo.findOpenByStoreId(store.id);
    if (open) return err(new PayoutRequestExistsError());

    const request = await this.requestRepo.create({
      storeId: store.id,
      amount,
      commission,
      balanceBefore: balance.available,
      status: "pending",
      note: input.note ?? null,
      payoutId: null,
      reviewedBy: null,
      reviewedAt: null,
      decisionNote: null,
    });

    return ok({ request, readyToPayout });
  }
}

export class CancelPayoutRequest {
  constructor(
    private readonly requestRepo: PayoutRequestRepository,
    private readonly storeRepo: StoreRepository,
  ) {}

  async execute(
    requestId: string,
    ownerUserId: EntityId,
  ): Promise<Result<{ request: PayoutRequestRecord }, Error>> {
    const request = await this.requestRepo.findById(requestId);
    if (!request) return err(new PayoutRequestNotFoundError());

    const store = await this.storeRepo.findById(request.storeId as EntityId);
    if (!store || store.ownerId !== ownerUserId) return err(new PayoutRequestNotOwnedError());
    if (request.status !== "pending") return err(new PayoutRequestNotReviewableError());

    await this.requestRepo.update(request.id, { status: "cancelled" });
    return ok({ request: { ...request, status: "cancelled" } });
  }
}

export class ListPayoutRequests {
  constructor(private readonly requestRepo: PayoutRequestRepository) {}

  async execute(filters: {
    storeId?: EntityId;
    status?: PayoutRequestStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ requests: PayoutRequestRecord[]; total: number }> {
    return this.requestRepo.list(filters);
  }
}

export interface ReviewPayoutRequestResult {
  decision: "approved" | "rejected";
  /** true when approval actually executed the money movement. */
  executed: boolean;
  error?: string;
  payout?: PayoutResult["payout"];
  disbursement?: PayoutResult["disbursement"];
  request: PayoutRequestRecord;
}

export class ReviewPayoutRequest {
  constructor(
    private readonly requestRepo: PayoutRequestRepository,
    private readonly storeRepo: StoreRepository,
    private readonly ledger: CommissionLedger,
    private readonly payoutRepo: PayoutRepository,
    private readonly accounts: SingaPayAccountsClientLike,
    private readonly settlementAccountNumber: string,
  ) {}

  async execute(
    requestId: string,
    input: { action: "approve" | "reject"; note?: string; adminId: string },
  ): Promise<Result<ReviewPayoutRequestResult, Error>> {
    const request = await this.requestRepo.findById(requestId);
    if (!request) return err(new PayoutRequestNotFoundError());
    if (request.status !== "pending" && request.status !== "approved") {
      return err(new PayoutRequestNotReviewableError());
    }

    const now = new Date().toISOString();

    if (input.action === "reject") {
      await this.requestRepo.update(request.id, {
        status: "rejected",
        reviewedBy: input.adminId,
        reviewedAt: now,
        decisionNote: input.note ?? null,
      });
      return ok({
        decision: "rejected",
        executed: false,
        request: { ...request, status: "rejected", reviewedBy: input.adminId, reviewedAt: now, decisionNote: input.note ?? null },
      });
    }

    // Approve → execute the real money movement (sweep commission + disburse).
    const result = await new RunPayout(
      this.storeRepo,
      this.ledger,
      this.payoutRepo,
      this.accounts,
      this.settlementAccountNumber,
    ).execute(request.storeId as EntityId);

    if (!result.ok) {
      // Keep the request approved (retryable) and surface the failure reason.
      const message = result.error.message;
      await this.requestRepo.update(request.id, {
        status: "approved",
        reviewedBy: input.adminId,
        reviewedAt: now,
        decisionNote: message,
      });
      return ok({
        decision: "approved",
        executed: false,
        error: message,
        request: { ...request, status: "approved", reviewedBy: input.adminId, reviewedAt: now, decisionNote: message },
      });
    }

    await this.requestRepo.update(request.id, {
      status: "paid",
      payoutId: result.value.payout.id,
      reviewedBy: input.adminId,
      reviewedAt: now,
      decisionNote: input.note ?? null,
    });
    return ok({
      decision: "approved",
      executed: true,
      payout: result.value.payout,
      disbursement: result.value.disbursement,
      request: {
        ...request,
        status: "paid",
        payoutId: result.value.payout.id,
        reviewedBy: input.adminId,
        reviewedAt: now,
        decisionNote: input.note ?? null,
      },
    });
  }
}
