/**
 * D1 Commission Ledger Repository.
 */

import { eq, sql, sum } from "drizzle-orm";
import type { EntityId } from "../../domain/shared/types";
import type { DbClient } from "../db/drizzle";
import { commissionEntries } from "../db/schema";

export interface CommissionEntry {
  id: string;
  storeId: string;
  orderId: string;
  orderAmount: number;
  rate: number;
  fee: number;
  createdAt: string;
}

export interface CommissionLedger {
  record(entry: Omit<CommissionEntry, "id" | "createdAt">): Promise<void>;
  sumByStoreId(storeId: EntityId): Promise<number>;
}

export class D1CommissionLedger implements CommissionLedger {
  constructor(private readonly db: DbClient) {}

  async record(entry: Omit<CommissionEntry, "id" | "createdAt">): Promise<void> {
    await this.db.insert(commissionEntries).values({
      id: crypto.randomUUID(),
      storeId: entry.storeId,
      orderId: entry.orderId,
      orderAmount: entry.orderAmount,
      rate: entry.rate,
      fee: entry.fee,
    });
  }

  async sumByStoreId(storeId: EntityId): Promise<number> {
    const row = await this.db
      .select({ total: sum(commissionEntries.fee) })
      .from(commissionEntries)
      .where(eq(commissionEntries.storeId, storeId as string))
      .get();
    return Number(row?.total ?? 0);
  }
}
