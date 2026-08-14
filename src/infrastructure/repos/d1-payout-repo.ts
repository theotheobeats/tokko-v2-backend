import { eq, desc, sql } from "drizzle-orm";
import type { EntityId } from "../../domain/shared/types";
import type { DbClient } from "../db/drizzle";
import { payouts } from "../db/schema";

export interface PayoutRecord {
  id: string;
  storeId: string;
  amount: number;
  commission: number;
  balanceBefore: number;
  sweepRef: string | null;
  payoutRef: string | null;
  providerTransactionId: string | null;
  status: "submitted" | "settled" | "failed";
  failedReason: string | null;
  createdAt: string;
}

export interface PayoutRepository {
  create(input: Omit<PayoutRecord, "id" | "createdAt">): Promise<PayoutRecord>;
  list(filters?: { storeId?: EntityId; limit?: number; offset?: number }): Promise<{ payouts: PayoutRecord[]; total: number }>;
  /** Find the payout created with this reference_number (disbursement webhook). */
  findByRef(referenceNumber: string): Promise<PayoutRecord | null>;
  /** Apply a provider-reported status change (disbursement webhook). */
  updateStatus(
    id: string,
    patch: {
      status: "settled" | "failed";
      providerTransactionId?: string | null;
      failedReason?: string | null;
    },
  ): Promise<void>;
}

export class D1PayoutRepository implements PayoutRepository {
  constructor(private readonly db: DbClient) {}

  async create(input: Omit<PayoutRecord, "id" | "createdAt">): Promise<PayoutRecord> {
    const record: PayoutRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await this.db.insert(payouts).values({
      id: record.id,
      storeId: record.storeId,
      amount: record.amount,
      commission: record.commission,
      balanceBefore: record.balanceBefore,
      sweepRef: record.sweepRef,
      payoutRef: record.payoutRef,
      providerTransactionId: record.providerTransactionId,
      status: record.status,
      failedReason: record.failedReason,
    });
    return record;
  }

  async list(filters: { storeId?: EntityId; limit?: number; offset?: number } = {}): Promise<{ payouts: PayoutRecord[]; total: number }> {
    const conditions = [];
    if (filters.storeId) conditions.push(eq(payouts.storeId, filters.storeId as string));
    const where = conditions.length > 0 ? sql`${payouts.storeId} = ${filters.storeId as string}` : undefined;

    const totalRow = filters.storeId
      ? await this.db.select({ count: sql<number>`count(*)` }).from(payouts).where(eq(payouts.storeId, filters.storeId as string)).get()
      : await this.db.select({ count: sql<number>`count(*)` }).from(payouts).get();

    const rows = await this.db
      .select()
      .from(payouts)
      .where(where)
      .orderBy(desc(payouts.createdAt))
      .limit(filters.limit ?? 50)
      .offset(filters.offset ?? 0)
      .all();

    return {
      payouts: rows.map((r) => this._toRecord(r)),
      total: Number(totalRow?.count ?? 0),
    };
  }

  async findByRef(referenceNumber: string): Promise<PayoutRecord | null> {
    const row = await this.db
      .select()
      .from(payouts)
      .where(eq(payouts.payoutRef, referenceNumber))
      .get();
    return row ? this._toRecord(row) : null;
  }

  async updateStatus(
    id: string,
    patch: { status: "settled" | "failed"; providerTransactionId?: string | null; failedReason?: string | null },
  ): Promise<void> {
    await this.db
      .update(payouts)
      .set({
        status: patch.status,
        ...(patch.providerTransactionId !== undefined ? { providerTransactionId: patch.providerTransactionId } : {}),
        ...(patch.failedReason !== undefined ? { failedReason: patch.failedReason } : {}),
      })
      .where(eq(payouts.id, id))
      .run();
  }

  private _toRecord(row: typeof payouts.$inferSelect): PayoutRecord {
    return {
      id: row.id,
      storeId: row.storeId,
      amount: row.amount,
      commission: row.commission,
      balanceBefore: row.balanceBefore,
      sweepRef: row.sweepRef,
      payoutRef: row.payoutRef,
      providerTransactionId: row.providerTransactionId,
      status: row.status as PayoutRecord["status"],
      failedReason: row.failedReason,
      createdAt: row.createdAt,
    };
  }
}
