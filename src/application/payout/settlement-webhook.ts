/**
 * Settlement webhook (SingaPay clearing process) — records settlement batches
 * that move funds from a merchant sub-account's pending_balance (dalam
 * kliring) to available_balance (siap cair).
 *
 * Normal settlement runs T+1..T+4 per payment method (docs: "Settlement"
 * guide). This handler records completed batches so the merchant earnings page
 * can show a clearing history without polling SingaPay on every view.
 *
 * Attribution caveat: the `settlement.completed` payload does not carry an
 * account id, so those batches are recorded with storeId NULL (visible in the
 * admin panel). Refund events carry `account_id`, which attributes the batch
 * to the owning store. Idempotent per SingaPay's `reference_no`.
 */

import type { Result } from "../../domain/shared/types";
import { ok } from "../../domain/shared/types";
import type { StoreRepository } from "../store/store-repo";
import type { SettlementRepository } from "../../infrastructure/repos/d1-settlement-repo";
import type { NormalizedSingaPaySettlementWebhook } from "../../infrastructure/payments/singapay-webhook";

export class HandleSettlementWebhook {
  constructor(
    private readonly settlementRepo: SettlementRepository,
    private readonly storeRepo: StoreRepository,
  ) {}

  async execute(
    input: NormalizedSingaPaySettlementWebhook,
  ): Promise<Result<{ handled: boolean }, never>> {
    const s = input.settlement;

    // Attribute best-effort: refund events carry account_id; the batch-level
    // account_id field is defensive (some environments may include it).
    const accountId = s.accountId ?? input.refund?.accountId ?? null;
    let storeId: string | null = null;
    if (accountId) {
      const store = await this.storeRepo.findBySingapayAccountId(accountId);
      if (store) storeId = store.id;
    }

    await this.settlementRepo.upsert({
      storeId,
      accountId,
      referenceNo: s.referenceNo,
      batchTitle: s.batchTitle,
      settlementType: s.settlementType,
      method: s.method,
      startDate: s.startDate,
      endDate: s.endDate,
      amount: s.amount,
      totalAdminFee: s.totalAdminFee,
      totalVendorFee: s.totalVendorFee,
      totalOurMargin: s.totalOurMargin,
      settlementFee: s.settlementFee,
      totalToTransfer: s.totalToTransfer,
      totalRefunded: s.totalRefunded,
      totalTransactions: s.totalTransactions,
      status: s.status,
      approvedBy: s.approvedBy,
      approvedAt: s.approvedAt,
    });

    return ok({ handled: true });
  }
}
