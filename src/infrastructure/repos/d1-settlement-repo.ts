import { eq, desc, sql } from "drizzle-orm";
import type { EntityId } from "../../domain/shared/types";
import type { DbClient } from "../db/drizzle";
import { settlements } from "../db/schema";

export interface SettlementRecord {
  id: string;
  storeId: string | null;
  accountId: string | null;
  referenceNo: string;
  batchTitle: string | null;
  settlementType: string | null;
  method: string | null;
  startDate: string | null;
  endDate: string | null;
  amount: number;
  totalAdminFee: number;
  totalVendorFee: number;
  totalOurMargin: number;
  settlementFee: number;
  totalToTransfer: number;
  totalRefunded: number;
  totalTransactions: number;
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface SettlementRepository {
  /** Idempotent batch insert (unique reference_no) — updates attribution/refund totals on redelivery. */
  upsert(input: Omit<SettlementRecord, "id" | "createdAt">): Promise<SettlementRecord>;
  findByReferenceNo(referenceNo: string): Promise<SettlementRecord | null>;
  findByStoreId(storeId: EntityId, limit?: number): Promise<SettlementRecord[]>;
  /** Recent batches across all stores (admin view). */
  listRecent(limit?: number): Promise<SettlementRecord[]>;
}

export class D1SettlementRepository implements SettlementRepository {
  constructor(private readonly db: DbClient) {}

  async upsert(input: Omit<SettlementRecord, "id" | "createdAt">): Promise<SettlementRecord> {
    const existing = await this.findByReferenceNo(input.referenceNo);
    if (existing) {
      // Redelivery or refund update — refresh attribution + refund totals.
      const updated: SettlementRecord = {
        ...existing,
        storeId: input.storeId ?? existing.storeId,
        accountId: input.accountId ?? existing.accountId,
        totalRefunded: input.totalRefunded,
      };
      await this.db
        .update(settlements)
        .set({
          storeId: updated.storeId,
          accountId: updated.accountId,
          totalRefunded: updated.totalRefunded,
        })
        .where(eq(settlements.id, existing.id))
        .run();
      return updated;
    }

    const record: SettlementRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await this.db.insert(settlements).values({
      id: record.id,
      storeId: record.storeId,
      accountId: record.accountId,
      referenceNo: record.referenceNo,
      batchTitle: record.batchTitle,
      settlementType: record.settlementType,
      method: record.method,
      startDate: record.startDate,
      endDate: record.endDate,
      amount: record.amount,
      totalAdminFee: record.totalAdminFee,
      totalVendorFee: record.totalVendorFee,
      totalOurMargin: record.totalOurMargin,
      settlementFee: record.settlementFee,
      totalToTransfer: record.totalToTransfer,
      totalRefunded: record.totalRefunded,
      totalTransactions: record.totalTransactions,
      status: record.status,
      approvedBy: record.approvedBy,
      approvedAt: record.approvedAt,
    });
    return record;
  }

  async findByReferenceNo(referenceNo: string): Promise<SettlementRecord | null> {
    const row = await this.db
      .select()
      .from(settlements)
      .where(eq(settlements.referenceNo, referenceNo))
      .get();
    return row ? this._toRecord(row) : null;
  }

  async findByStoreId(storeId: EntityId, limit = 20): Promise<SettlementRecord[]> {
    const rows = await this.db
      .select()
      .from(settlements)
      .where(eq(settlements.storeId, storeId as string))
      .orderBy(desc(settlements.approvedAt), desc(settlements.createdAt))
      .limit(limit)
      .all();
    return rows.map((r) => this._toRecord(r));
  }

  async listRecent(limit = 30): Promise<SettlementRecord[]> {
    const rows = await this.db
      .select()
      .from(settlements)
      .orderBy(desc(settlements.approvedAt), desc(settlements.createdAt))
      .limit(limit)
      .all();
    return rows.map((r) => this._toRecord(r));
  }

  private _toRecord(row: typeof settlements.$inferSelect): SettlementRecord {
    return {
      id: row.id,
      storeId: row.storeId,
      accountId: row.accountId,
      referenceNo: row.referenceNo,
      batchTitle: row.batchTitle,
      settlementType: row.settlementType,
      method: row.method,
      startDate: row.startDate,
      endDate: row.endDate,
      amount: row.amount,
      totalAdminFee: row.totalAdminFee,
      totalVendorFee: row.totalVendorFee,
      totalOurMargin: row.totalOurMargin,
      settlementFee: row.settlementFee,
      totalToTransfer: row.totalToTransfer,
      totalRefunded: row.totalRefunded,
      totalTransactions: row.totalTransactions,
      status: row.status,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      createdAt: row.createdAt,
    };
  }
}
