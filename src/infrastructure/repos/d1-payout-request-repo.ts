import { eq, and, desc, sql } from "drizzle-orm";
import type { EntityId } from "../../domain/shared/types";
import type { DbClient } from "../db/drizzle";
import { payoutRequests } from "../db/schema";

export type PayoutRequestStatus = "pending" | "approved" | "paid" | "rejected" | "cancelled";

export interface PayoutRequestRecord {
  id: string;
  storeId: string;
  amount: number;
  commission: number;
  balanceBefore: number;
  status: PayoutRequestStatus;
  note: string | null;
  payoutId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface PayoutRequestRepository {
  create(input: Omit<PayoutRequestRecord, "id" | "createdAt">): Promise<PayoutRequestRecord>;
  findById(id: string): Promise<PayoutRequestRecord | null>;
  /** Open request for a store (pending or approved) — one at a time. */
  findOpenByStoreId(storeId: EntityId): Promise<PayoutRequestRecord | null>;
  list(filters?: {
    storeId?: EntityId;
    status?: PayoutRequestStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ requests: PayoutRequestRecord[]; total: number }>;
  update(
    id: string,
    patch: Partial<Pick<PayoutRequestRecord, "status" | "payoutId" | "reviewedBy" | "reviewedAt" | "decisionNote">>,
  ): Promise<void>;
}

export class D1PayoutRequestRepository implements PayoutRequestRepository {
  constructor(private readonly db: DbClient) {}

  async create(input: Omit<PayoutRequestRecord, "id" | "createdAt">): Promise<PayoutRequestRecord> {
    const record: PayoutRequestRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await this.db.insert(payoutRequests).values({
      id: record.id,
      storeId: record.storeId,
      amount: record.amount,
      commission: record.commission,
      balanceBefore: record.balanceBefore,
      status: record.status,
      note: record.note,
      payoutId: record.payoutId,
      reviewedBy: record.reviewedBy,
      reviewedAt: record.reviewedAt,
      decisionNote: record.decisionNote,
    });
    return record;
  }

  async findById(id: string): Promise<PayoutRequestRecord | null> {
    const row = await this.db.select().from(payoutRequests).where(eq(payoutRequests.id, id)).get();
    return row ? this._toRecord(row) : null;
  }

  async findOpenByStoreId(storeId: EntityId): Promise<PayoutRequestRecord | null> {
    const row = await this.db
      .select()
      .from(payoutRequests)
      .where(
        and(
          eq(payoutRequests.storeId, storeId as string),
          sql`${payoutRequests.status} IN ('pending', 'approved')`,
        ),
      )
      .orderBy(desc(payoutRequests.createdAt))
      .get();
    return row ? this._toRecord(row) : null;
  }

  async list(filters: {
    storeId?: EntityId;
    status?: PayoutRequestStatus;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ requests: PayoutRequestRecord[]; total: number }> {
    const conditions = [];
    if (filters.storeId) conditions.push(eq(payoutRequests.storeId, filters.storeId as string));
    if (filters.status) conditions.push(eq(payoutRequests.status, filters.status));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const totalRow = where
      ? await this.db.select({ count: sql<number>`count(*)` }).from(payoutRequests).where(where).get()
      : await this.db.select({ count: sql<number>`count(*)` }).from(payoutRequests).get();

    const rows = await this.db
      .select()
      .from(payoutRequests)
      .where(where)
      .orderBy(desc(payoutRequests.createdAt))
      .limit(filters.limit ?? 50)
      .offset(filters.offset ?? 0)
      .all();

    return {
      requests: rows.map((r) => this._toRecord(r)),
      total: Number(totalRow?.count ?? 0),
    };
  }

  async update(
    id: string,
    patch: Partial<Pick<PayoutRequestRecord, "status" | "payoutId" | "reviewedBy" | "reviewedAt" | "decisionNote">>,
  ): Promise<void> {
    await this.db
      .update(payoutRequests)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.payoutId !== undefined ? { payoutId: patch.payoutId } : {}),
        ...(patch.reviewedBy !== undefined ? { reviewedBy: patch.reviewedBy } : {}),
        ...(patch.reviewedAt !== undefined ? { reviewedAt: patch.reviewedAt } : {}),
        ...(patch.decisionNote !== undefined ? { decisionNote: patch.decisionNote } : {}),
      })
      .where(eq(payoutRequests.id, id))
      .run();
  }

  private _toRecord(row: typeof payoutRequests.$inferSelect): PayoutRequestRecord {
    return {
      id: row.id,
      storeId: row.storeId,
      amount: row.amount,
      commission: row.commission,
      balanceBefore: row.balanceBefore,
      status: row.status as PayoutRequestStatus,
      note: row.note,
      payoutId: row.payoutId,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt,
      decisionNote: row.decisionNote,
      createdAt: row.createdAt,
    };
  }
}
