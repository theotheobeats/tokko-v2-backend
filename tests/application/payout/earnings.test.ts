import { describe, it, expect, vi } from "vitest";
import { GetEarningsDashboard } from "../../../src/application/payout/earnings";
import { Store } from "../../../src/domain/store/store";
import { BusinessType, Aesthetic } from "../../../src/domain/store/types";
import { createEntityId } from "../../../src/domain/shared/types";
import { Order } from "../../../src/domain/order/order";
import type { StoreRepository } from "../../../src/application/store/store-repo";
import type { OrderRepository } from "../../../src/infrastructure/repos/d1-order-repo";
import type { CommissionLedger } from "../../../src/infrastructure/repos/d1-commission-ledger";
import type { PayoutRepository } from "../../../src/infrastructure/repos/d1-payout-repo";
import type { PayoutRequestRepository } from "../../../src/infrastructure/repos/d1-payout-request-repo";
import type { SettlementRepository } from "../../../src/infrastructure/repos/d1-settlement-repo";
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
    .updatePaymentProviderAccount("acc-anna", "kyb_verified")
    .setPayoutBank({ code: "014", accountNumber: "1234567890", accountName: "Anna" });
}

function mockStoreRepo(store: Store): StoreRepository {
  return {
    findById: vi.fn().mockResolvedValue(store),
    findBySubdomain: vi.fn().mockResolvedValue(null),
    findByOwnerId: vi.fn().mockResolvedValue(null),
    findBySingapayAccountId: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    countProducts: vi.fn().mockResolvedValue(0),
    countPhysicalProductsMissingShipping: vi.fn().mockResolvedValue(0),
    listAll: vi.fn().mockResolvedValue({ stores: [], total: 0 }),
    countAll: vi.fn().mockResolvedValue({ total: 0, published: 0, draft: 0, suspended: 0 }),
    delete: vi.fn().mockResolvedValue(undefined),
    listByTrialSet: vi.fn().mockResolvedValue([]),
    listPausedBefore: vi.fn().mockResolvedValue([]),
  };
}

function mockAccounts(balance = { available: 1_250_000, balance: 1_250_000, pending: 200_000, held: 0 }): SingaPayAccountsClientLike {
  return {
    createSubAccount: vi.fn(),
    getAccount: vi.fn(),
    listPaymentMethods: vi.fn(),
    checkBalance: vi.fn().mockResolvedValue(balance),
    checkFee: vi.fn(),
    checkBeneficiary: vi.fn(),
    disburse: vi.fn(),
    accountTransfer: vi.fn(),
  };
}

function makePaidOrder(storeId: string, amount: number, daysAgo: number): Order {
  const createdAt = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const order = Order.create({
    storeId,
    customerName: "Budi",
    customerPhone: "628123456789",
    items: [{ productId: "p1", productName: "Roti", quantity: 1, unitPrice: amount, productType: "product" as const }],
    shippingOption: "manual",
  });
  order.updateFulfillment({ paymentConfirmed: true, status: "completed" });
  // createdAt is set at creation; patch the ISO for period bucketing.
  const originalToJSON = order.toJSON.bind(order);
  (order as unknown as { toJSON(): { createdAt?: string } }).toJSON = () => ({
    ...originalToJSON(),
    createdAt,
  });
  return order;
}

describe("GetEarningsDashboard", () => {
  it("aggregates period earnings, ready-to-payout and the merged transaction log", async () => {
    const store = makeStore();
    const orders = [
      makePaidOrder(store.id, 100_000, 0), // today
      makePaidOrder(store.id, 200_000, 3), // this week
      makePaidOrder(store.id, 300_000, 20), // this month
      makePaidOrder(store.id, 400_000, 60), // outside all periods
    ];
    const orderRepo: OrderRepository = {
      findById: vi.fn(),
      findByStoreId: vi.fn().mockResolvedValue(orders),
      countByStoreId: vi.fn(),
      save: vi.fn(),
      listAll: vi.fn(),
      countAll: vi.fn(),
      sumTotalAll: vi.fn(),
      since: vi.fn(),
      deleteByStoreId: vi.fn(),
    };
    const ledger: CommissionLedger = {
      record: vi.fn(),
      sumByStoreId: vi.fn().mockResolvedValue(10_000),
      listByStoreId: vi.fn().mockResolvedValue([
        { id: "c1", storeId: store.id, orderId: orders[0].id, orderAmount: 100_000, rate: 3.5, fee: 3_500, createdAt: "2026-08-10 00:00:00" },
      ]),
    };
    const payoutRepo: PayoutRepository = {
      create: vi.fn(),
      list: vi.fn().mockResolvedValue({
        payouts: [
          {
            id: "p1",
            storeId: store.id,
            amount: 500_000,
            commission: 10_000,
            balanceBefore: 1_250_000,
            sweepRef: "sw-1",
            payoutRef: "payout-ref-1",
            providerTransactionId: null,
            status: "settled",
            failedReason: null,
            createdAt: "2026-08-05 00:00:00",
          },
        ],
        total: 1,
      }),
      findByRef: vi.fn(),
      updateStatus: vi.fn(),
    };
    const requestRepo: PayoutRequestRepository = {
      create: vi.fn(),
      findById: vi.fn(),
      findOpenByStoreId: vi.fn(),
      list: vi.fn().mockResolvedValue({
        requests: [
          {
            id: "r1",
            storeId: store.id,
            amount: 300_000,
            commission: 10_000,
            balanceBefore: 1_250_000,
            status: "pending",
            note: null,
            payoutId: null,
            reviewedBy: null,
            reviewedAt: null,
            decisionNote: null,
            createdAt: "2026-08-09 00:00:00",
          },
        ],
        total: 1,
      }),
      update: vi.fn(),
    };
    const settlementRepo: SettlementRepository = {
      upsert: vi.fn(),
      findByReferenceNo: vi.fn(),
      findByStoreId: vi.fn().mockResolvedValue([]),
      listRecent: vi.fn(),
    };

    const result = await new GetEarningsDashboard(
      mockStoreRepo(store),
      ledger,
      mockAccounts(),
      orderRepo,
      payoutRepo,
      requestRepo,
      settlementRepo,
    ).execute(store.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const v = result.value;
    expect(v.balance.available).toBe(1_250_000);
    expect(v.commissionOwed).toBe(10_000);
    expect(v.readyToPayout).toBe(1_240_000);
    expect(v.clearing.pending).toBe(200_000);

    // Period buckets: today = 1 order, this week = 2, this month = 3, total = 4.
    expect(v.earnings.today.gross).toBe(100_000);
    expect(v.earnings.today.orders).toBe(1);
    expect(v.earnings.thisWeek.gross).toBe(300_000);
    expect(v.earnings.thisWeek.orders).toBe(2);
    expect(v.earnings.thisMonth.gross).toBe(600_000);
    expect(v.earnings.thisMonth.orders).toBe(3);
    expect(v.earnings.total.gross).toBe(1_000_000);
    expect(v.earnings.total.orders).toBe(4);
    // Commission only counted for the order that has a ledger entry.
    expect(v.earnings.total.commission).toBe(3_500);

    // Merged transaction log: 4 orders + 1 payout + 1 request = 6, newest first.
    expect(v.transactions).toHaveLength(6);
    expect(v.transactions[0].type).toBe("order");
    expect(v.transactions.some((t) => t.type === "payout" && t.ref === "payout-ref-1")).toBe(true);
    expect(v.transactions.some((t) => t.type === "payout_request" && t.ref === "PR-r1")).toBe(true);

    expect(v.payouts).toHaveLength(1);
    expect(v.payoutRequests).toHaveLength(1);
  });

  it("returns zero state without a SingaPay account", async () => {
    const store = Store.create({
      ownerId,
      name: "Anna Bakery",
      businessType: BusinessType.Food,
      aestheticPreference: Aesthetic.Warm,
      whatsappNumber: "628123456789",
    });
    const orderRepo: OrderRepository = {
      findById: vi.fn(),
      findByStoreId: vi.fn().mockResolvedValue([]),
      countByStoreId: vi.fn(),
      save: vi.fn(),
      listAll: vi.fn(),
      countAll: vi.fn(),
      sumTotalAll: vi.fn(),
      since: vi.fn(),
      deleteByStoreId: vi.fn(),
    };
    const ledger: CommissionLedger = {
      record: vi.fn(),
      sumByStoreId: vi.fn().mockResolvedValue(0),
      listByStoreId: vi.fn().mockResolvedValue([]),
    };
    const empty = {
      create: vi.fn(),
      findById: vi.fn(),
      findOpenByStoreId: vi.fn(),
      list: vi.fn().mockResolvedValue({ requests: [], total: 0 }),
      update: vi.fn(),
    } as unknown as PayoutRequestRepository;
    const emptyPayouts = {
      create: vi.fn(),
      list: vi.fn().mockResolvedValue({ payouts: [], total: 0 }),
      findByRef: vi.fn(),
      updateStatus: vi.fn(),
    } as unknown as PayoutRepository;
    const emptySettlements = {
      upsert: vi.fn(),
      findByReferenceNo: vi.fn(),
      findByStoreId: vi.fn().mockResolvedValue([]),
      listRecent: vi.fn(),
    } as unknown as SettlementRepository;

    const result = await new GetEarningsDashboard(
      mockStoreRepo(store),
      ledger,
      mockAccounts({ available: 0, balance: 0, pending: 0, held: 0 }),
      orderRepo,
      emptyPayouts,
      empty,
      emptySettlements,
    ).execute(store.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.readyToPayout).toBe(0);
    expect(result.value.earnings.total.gross).toBe(0);
    expect(result.value.transactions).toHaveLength(0);
  });

  it("falls back to master account balance + settlements for whitelisted test users", async () => {
    // Store HAS a sub-account but it is pre-KYB (kyb_in_review, no money) —
    // whitelisted users must read the master account instead.
    const store = Store.create({
      ownerId,
      name: "Anna Bakery",
      businessType: BusinessType.Food,
      aestheticPreference: Aesthetic.Warm,
      whatsappNumber: "628123456789",
    }).updatePaymentProviderAccount("01KZT9ZAWR132QREKQWAV844QE", "kyb_in_review");
    const orderRepo: OrderRepository = {
      findById: vi.fn(),
      findByStoreId: vi.fn().mockResolvedValue([]),
      countByStoreId: vi.fn(),
      save: vi.fn(),
      listAll: vi.fn(),
      countAll: vi.fn(),
      sumTotalAll: vi.fn(),
      since: vi.fn(),
      deleteByStoreId: vi.fn(),
    };
    const ledger: CommissionLedger = {
      record: vi.fn(),
      sumByStoreId: vi.fn().mockResolvedValue(50_000),
      listByStoreId: vi.fn().mockResolvedValue([]),
    };
    const empty = {
      create: vi.fn(),
      findById: vi.fn(),
      findOpenByStoreId: vi.fn(),
      list: vi.fn().mockResolvedValue({ requests: [], total: 0 }),
      update: vi.fn(),
    } as unknown as PayoutRequestRepository;
    const emptyPayouts = {
      create: vi.fn(),
      list: vi.fn().mockResolvedValue({ payouts: [], total: 0 }),
      findByRef: vi.fn(),
      updateStatus: vi.fn(),
    } as unknown as PayoutRepository;
    const settlementRepo = {
      upsert: vi.fn(),
      findByReferenceNo: vi.fn(),
      findByStoreId: vi.fn().mockResolvedValue([]),
      listRecent: vi.fn().mockResolvedValue([
        {
          id: "sett-1",
          storeId: null,
          accountId: null,
          referenceNo: "SETTLEMENT-1-ABC",
          batchTitle: "Settlement Master",
          settlementType: "ALL",
          method: "balance",
          startDate: null,
          endDate: null,
          amount: 1_000_000,
          totalAdminFee: 0,
          totalVendorFee: 0,
          totalOurMargin: 0,
          settlementFee: 0,
          totalToTransfer: 1_000_000,
          totalRefunded: 0,
          totalTransactions: 5,
          status: "completed",
          approvedBy: "SYSTEM",
          approvedAt: "2026-08-13 10:00:00",
          createdAt: "2026-08-13 10:00:00",
        },
      ]),
    } as unknown as SettlementRepository;

    const access = { emails: ["asakvsa.idn@gmail.com"], masterAccountId: "master-acc" };
    const accounts = mockAccounts({ available: 1_250_000, balance: 1_250_000, pending: 200_000, held: 0 });

    const result = await new GetEarningsDashboard(
      mockStoreRepo(store),
      ledger,
      accounts,
      orderRepo,
      emptyPayouts,
      empty,
      settlementRepo,
      access,
    ).execute(store.id, "asakvsa.idn@gmail.com");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const v = result.value;
    expect(v.summary.kybStatus).toBe("kyb_verified"); // effective — unlocks the payout request UI
    expect(v.summary.subAccountId).toBe("master-acc");
    expect(accounts.checkBalance).toHaveBeenCalledWith("master-acc");
    expect(v.balance.available).toBe(1_250_000);
    expect(v.readyToPayout).toBe(1_200_000); // 1_250_000 - 50_000 commission
    expect(v.clearing.pending).toBe(200_000);
    // Settlement fallback: master batches (storeId NULL) shown instead of per-store.
    expect(settlementRepo.listRecent).toHaveBeenCalled();
    expect(settlementRepo.findByStoreId).not.toHaveBeenCalled();
    expect(v.clearing.settlements).toHaveLength(1);
  });
});
