/**
 * Merchant earnings dashboard — the "Penghasilan" page data.
 *
 * Everything is derived from OUR data (orders/payments/commission/payouts) +
 * the live SingaPay balance; we do not poll SingaPay statements.
 *
 *   - earnings:   gross order totals of payment-confirmed orders, by period,
 *                 with the platform commission deducted (net = merchant's).
 *   - clearing:   pending_balance (live, "dalam kliring", settles T+1..T+4)
 *                 + recorded settlement batches (settlement webhook).
 *   - readyToPayout: available_balance − commission owed.
 *   - transactions: merged log of paid orders, payouts and payout requests.
 */

import type { Result } from "../../domain/shared/types";
import { ok, err, type EntityId } from "../../domain/shared/types";
import type { StoreRepository } from "../store/store-repo";
import type { OrderRepository } from "../../infrastructure/repos/d1-order-repo";
import type { CommissionLedger } from "../../infrastructure/repos/d1-commission-ledger";
import type { PayoutRepository, PayoutRecord } from "../../infrastructure/repos/d1-payout-repo";
import type { PayoutRequestRepository, PayoutRequestRecord } from "../../infrastructure/repos/d1-payout-request-repo";
import type { SettlementRepository, SettlementRecord } from "../../infrastructure/repos/d1-settlement-repo";
import type { SingaPayAccountsClientLike, SingaPayBalance } from "../../infrastructure/payments/singapay-client";
import { bankCodeFor, bankNameFor, quoteDisbursementFee } from "../admin/admin-payouts";
import { EMPTY_TEST_ACCESS, isTestEmail, type TestAccess } from "./test-access";
import type { Order } from "../../domain/order/order";

export class EarningsStoreNotFoundError extends Error {
  code = "STORE_NOT_FOUND";
  constructor() { super("Toko tidak ditemukan"); }
}
export class EarningsProviderError extends Error {
  code = "PAYOUT_PROVIDER_ERROR";
  constructor(message: string) { super(message); }
}

/** Single merged transaction-log row. */
export interface EarningsTransaction {
  type: "order" | "payout" | "payout_request";
  id: string;
  /** Human-friendly ref: order code / payout ref / PR-… */
  ref: string;
  amount: number;
  commission: number;
  net: number;
  status: string;
  date: string;
}

export interface EarningsPeriod {
  gross: number;
  commission: number;
  net: number;
  orders: number;
}

export interface EarningsDashboardView {
  summary: {
    storeId: string;
    storeName: string;
    subdomain: string;
    subAccountId: string | null;
    kybStatus: string | null;
    payoutBank: { name: string | null; accountNumber: string | null; holder: string | null } | null;
    bankCode: string | null;
  };
  balance: SingaPayBalance;
  commissionOwed: number;
  readyToPayout: number;
  earnings: { today: EarningsPeriod; thisWeek: EarningsPeriod; thisMonth: EarningsPeriod; total: EarningsPeriod };
  clearing: { pending: number; settlements: SettlementRecord[] };
  transactions: EarningsTransaction[];
  payouts: PayoutRecord[];
  payoutRequests: PayoutRequestRecord[];
}

/** Format "YYYY-MM-DD HH:MM:SS" (UTC) — matches SQLite datetime('now'). */
function utcStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function startOfUtcDay(daysAgo: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return utcStamp(d);
}

function emptyPeriod(): EarningsPeriod {
  return { gross: 0, commission: 0, net: 0, orders: 0 };
}

export class GetEarningsDashboard {
  constructor(
    private readonly storeRepo: StoreRepository,
    private readonly ledger: CommissionLedger,
    private readonly accounts: SingaPayAccountsClientLike,
    private readonly orderRepo: OrderRepository,
    private readonly payoutRepo: PayoutRepository,
    private readonly requestRepo: PayoutRequestRepository,
    private readonly settlementRepo: SettlementRepository,
    /** Test access (KYB bypass + master-account balance/settlement fallback). */
    private readonly testAccess: TestAccess = EMPTY_TEST_ACCESS,
  ) {}

  async execute(
    storeId: EntityId,
    ownerEmail?: string,
  ): Promise<Result<EarningsDashboardView, EarningsStoreNotFoundError | EarningsProviderError>> {
    const store = await this.storeRepo.findById(storeId);
    if (!store) return err(new EarningsStoreNotFoundError());

    const isTest = isTestEmail(ownerEmail, this.testAccess);
    const effectiveKyb = store.kybStatus === "kyb_verified" || isTest ? "kyb_verified" : store.kybStatus;
    // Test users ALWAYS read the master account (their own sub-account is
    // pre-KYB with zero balance; test money settles into the master). Real
    // merchants use their own sub-account.
    const accountId = isTest
      ? this.testAccess.masterAccountId ?? store.singapayAccountId
      : store.singapayAccountId;

    // Live SingaPay balance (funds live in the merchant's own sub-account).
    let balance: SingaPayBalance = { available: 0, balance: 0, pending: 0, held: 0 };
    if (accountId) {
      try {
        balance = await this.accounts.checkBalance(accountId);
      } catch (e) {
        return err(new EarningsProviderError(e instanceof Error ? e.message : "Gagal membaca saldo."));
      }
    }

    const [commissionOwed, commissionEntries, paidOrders, payouts, payoutRequests, settlements] =
      await Promise.all([
        this.ledger.sumByStoreId(store.id),
        this.ledger.listByStoreId(store.id),
        this.orderRepo.findByStoreId(store.id, { paidOnly: true, limit: 10_000 }),
        this.payoutRepo.list({ storeId, limit: 20 }),
        this.requestRepo.list({ storeId, limit: 20 }),
        // Test stores without their own sub-account see the platform's clearing batches.
        accountId === this.testAccess.masterAccountId && accountId !== store.singapayAccountId
          ? this.settlementRepo.listRecent(20)
          : this.settlementRepo.findByStoreId(store.id, 20),
      ]);

    const commissionByOrder = new Map<string, number>();
    for (const entry of commissionEntries) {
      commissionByOrder.set(entry.orderId, (commissionByOrder.get(entry.orderId) ?? 0) + entry.fee);
    }

    // Period aggregates over paid orders.
    const periods = {
      today: startOfUtcDay(0),
      thisWeek: startOfUtcDay(6),
      thisMonth: startOfUtcDay(29),
    };
    const agg = (orders: Order[], since?: string): EarningsPeriod => {
      const out = emptyPeriod();
      for (const o of orders) {
        const created = o.toJSON().createdAt ?? "";
        if (since && created < since) continue;
        const fee = commissionByOrder.get(o.id) ?? 0;
        out.gross += o.totalAmount;
        out.commission += fee;
        out.net += o.totalAmount - fee;
        out.orders += 1;
      }
      return out;
    };
    const earnings = {
      today: agg(paidOrders, periods.today),
      thisWeek: agg(paidOrders, periods.thisWeek),
      thisMonth: agg(paidOrders, periods.thisMonth),
      total: agg(paidOrders),
    };

    // Merged transaction log (newest first).
    const transactions: EarningsTransaction[] = [
      ...paidOrders.map((o) => {
        const fee = commissionByOrder.get(o.id) ?? 0;
        return {
          type: "order" as const,
          id: o.id,
          ref: o.orderCode ?? o.id.slice(0, 8),
          amount: o.totalAmount,
          commission: fee,
          net: o.totalAmount - fee,
          status: o.status,
          date: o.toJSON().createdAt ?? "",
        };
      }),
      ...payouts.payouts.map((p) => ({
        type: "payout" as const,
        id: p.id,
        ref: p.payoutRef ?? p.id.slice(0, 8),
        amount: p.amount,
        commission: p.commission,
        net: p.amount,
        status: p.status,
        date: p.createdAt,
      })),
      ...payoutRequests.requests.map((r) => ({
        type: "payout_request" as const,
        id: r.id,
        ref: `PR-${r.id.slice(0, 8)}`,
        amount: r.amount,
        commission: r.commission,
        net: r.amount,
        status: r.status,
        date: r.createdAt,
      })),
    ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 60);

    const bankCode = store.payoutBankCode ?? bankCodeFor(store.bankName);
    const accountNumber = store.payoutBankAccountNumber ?? store.bankAccountNumber;
    const accountName = store.payoutBankAccountName ?? store.bankAccountName;

    // Disbursement debits amount + fee — show the net ready amount so the
    // merchant requests what can actually be paid out (else SP003).
    const fee = accountId
      ? await quoteDisbursementFee(this.accounts, accountId, bankCode ?? "", Math.max(0, balance.available - commissionOwed))
      : 0;
    const readyToPayout = Math.max(0, balance.available - commissionOwed - fee);

    return ok({
      summary: {
        storeId: store.id,
        storeName: store.name,
        subdomain: store.subdomain,
        subAccountId: accountId,
        kybStatus: effectiveKyb,
        payoutBank: accountNumber
          ? { name: bankNameFor(bankCode) ?? store.bankName, accountNumber, holder: accountName }
          : null,
        bankCode,
      },
      balance,
      commissionOwed,
      readyToPayout,
      earnings,
      clearing: { pending: balance.pending, settlements },
      transactions,
      payouts: payouts.payouts,
      payoutRequests: payoutRequests.requests,
    });
  }
}
