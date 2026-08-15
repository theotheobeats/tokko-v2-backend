import { describe, it, expect, vi } from "vitest";
import {
  normalizeSingaPaySettlementWebhook,
  type SingaPaySettlementWebhookPayload,
} from "../../../src/infrastructure/payments/singapay-webhook";
import { HandleSettlementWebhook } from "../../../src/application/payout/settlement-webhook";
import type { SettlementRepository, SettlementRecord } from "../../../src/infrastructure/repos/d1-settlement-repo";
import type { StoreRepository } from "../../../src/application/store/store-repo";
import { Store } from "../../../src/domain/store/store";
import { BusinessType, Aesthetic } from "../../../src/domain/store/types";
import { createEntityId } from "../../../src/domain/shared/types";

const completedPayload: SingaPaySettlementWebhookPayload = {
  event: "settlement.completed",
  data: {
    settlement: {
      reference_no: "SETTLEMENT-1-ABC123",
      title: "Settlement Anna Bakery (01 Jun 2026 - 17 Jun 2026)",
      settlement_type: "ALL",
      settlement_method: "balance",
      start_date: "01 Jun 2026 00:00:00",
      end_date: "17 Jun 2026 23:59:59",
      amount: 1_000_000,
      total_admin_fee: 5_000,
      total_vendor_fee: 3_000,
      total_our_margin: 2_000,
      settlement_fee: 0,
      total_to_transfer: 1_000_000,
      total_refunded: 0,
      status: "completed",
      approved_by: "SYSTEM",
      approved_at: "18 Jun 2026 10:00:00",
    },
    total_transactions: 5,
  },
};

function mockSettlementRepo(): SettlementRepository {
  return {
    upsert: vi.fn().mockImplementation(async (input) => ({
      ...input,
      id: "sett-1",
      createdAt: new Date().toISOString(),
    }) as Promise<SettlementRecord>),
    findByReferenceNo: vi.fn().mockResolvedValue(null),
    findByStoreId: vi.fn().mockResolvedValue([]),
    listRecent: vi.fn().mockResolvedValue([]),
  };
}

function mockStoreRepo(store?: Store | null): StoreRepository {
  return {
    findById: vi.fn().mockResolvedValue(store ?? null),
    findBySubdomain: vi.fn().mockResolvedValue(null),
    findByOwnerId: vi.fn().mockResolvedValue(null),
    findBySingapayAccountId: vi.fn().mockResolvedValue(store ?? null),
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

describe("normalizeSingaPaySettlementWebhook", () => {
  it("maps a settlement.completed payload to the internal shape", () => {
    const normalized = normalizeSingaPaySettlementWebhook(completedPayload);

    expect(normalized).not.toBeNull();
    expect(normalized?.event).toBe("settlement.completed");
    expect(normalized?.settlement.referenceNo).toBe("SETTLEMENT-1-ABC123");
    expect(normalized?.settlement.amount).toBe(1_000_000);
    expect(normalized?.settlement.totalToTransfer).toBe(1_000_000);
    expect(normalized?.settlement.totalTransactions).toBe(5);
    expect(normalized?.settlement.accountId).toBeNull();
    expect(normalized?.refund).toBeNull();
  });

  it("carries account_id from a refund event", () => {
    const payload: SingaPaySettlementWebhookPayload = {
      event: "settlement.refunded",
      data: {
        settlement: { reference_no: "SETTLEMENT-1-ABC123", amount: 1_000_000 },
        refund: {
          account_id: "01HZX9K3P2J4M6N8Q0R2T4V6W8",
          net_amount: { value: 95_000, currency: "IDR" },
        },
      },
    };

    const normalized = normalizeSingaPaySettlementWebhook(payload);

    expect(normalized?.event).toBe("settlement.refunded");
    expect(normalized?.settlement.accountId).toBe("01HZX9K3P2J4M6N8Q0R2T4V6W8");
    expect(normalized?.refund?.netAmount).toBe(95_000);
  });

  it("returns null for unknown events or missing references", () => {
    expect(normalizeSingaPaySettlementWebhook({ event: "something.else", data: {} })).toBeNull();
    expect(normalizeSingaPaySettlementWebhook({ event: "settlement.completed", data: {} })).toBeNull();
  });
});

describe("HandleSettlementWebhook", () => {
  it("records a completed batch idempotently by reference", async () => {
    const normalized = normalizeSingaPaySettlementWebhook(completedPayload);
    if (!normalized) throw new Error("expected normalized payload");

    const settlementRepo = mockSettlementRepo();
    const storeRepo = mockStoreRepo(null); // no account_id → no attribution

    const result = await new HandleSettlementWebhook(settlementRepo, storeRepo).execute(normalized);

    expect(result.ok).toBe(true);
    expect(settlementRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceNo: "SETTLEMENT-1-ABC123",
        storeId: null,
        accountId: null,
        amount: 1_000_000,
      }),
    );
    expect(storeRepo.findBySingapayAccountId).not.toHaveBeenCalled();
  });

  it("attributes the batch to the store when account_id matches a sub-account", async () => {
    const store = Store.create({
      ownerId: createEntityId(),
      name: "Anna Bakery",
      businessType: BusinessType.Food,
      aestheticPreference: Aesthetic.Warm,
      whatsappNumber: "628123456789",
    }).updatePaymentProviderAccount("01HZX9K3P2J4M6N8Q0R2T4V6W8", "kyb_verified");

    const payload: SingaPaySettlementWebhookPayload = {
      event: "settlement.refunded",
      data: {
        settlement: { reference_no: "SETTLEMENT-1-ABC123", amount: 1_000_000 },
        refund: { account_id: "01HZX9K3P2J4M6N8Q0R2T4V6W8", net_amount: { value: 95_000 } },
      },
    };
    const normalized = normalizeSingaPaySettlementWebhook(payload);
    if (!normalized) throw new Error("expected normalized payload");

    const settlementRepo = mockSettlementRepo();
    const storeRepo = mockStoreRepo(store);

    const result = await new HandleSettlementWebhook(settlementRepo, storeRepo).execute(normalized);

    expect(result.ok).toBe(true);
    expect(storeRepo.findBySingapayAccountId).toHaveBeenCalledWith("01HZX9K3P2J4M6N8Q0R2T4V6W8");
    expect(settlementRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: store.id, accountId: "01HZX9K3P2J4M6N8Q0R2T4V6W8" }),
    );
  });
});
