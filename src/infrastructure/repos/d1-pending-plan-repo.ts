/**
 * D1 Pending Plan Repository.
 */

import { eq, and, sql } from "drizzle-orm";
import type { EntityId } from "../../domain/shared/types";
import type { DbClient } from "../db/drizzle";
import { pendingPlans } from "../db/schema";

export interface PendingPlanRow {
  id: string;
  userId: string;
  plan: "pro" | "commerce";
  cycle: "monthly" | "annual";
  currentPeriodEnd: string | null;
  externalRef: string | null;
  status: "pending" | "consumed";
  createdAt: string;
  consumedAt: string | null;
}

export interface PendingPlanRepository {
  /** Unconsumed paid plan for a user (latest first). */
  findByUserIdConsumable(userId: EntityId): Promise<PendingPlanRow | null>;
  save(row: Omit<PendingPlanRow, "createdAt" | "consumedAt" | "status">): Promise<void>;
  markConsumed(id: string): Promise<void>;
}

export class D1PendingPlanRepository implements PendingPlanRepository {
  constructor(private readonly db: DbClient) {}

  async findByUserIdConsumable(userId: EntityId): Promise<PendingPlanRow | null> {
    const row = await this.db
      .select()
      .from(pendingPlans)
      .where(and(eq(pendingPlans.userId, userId as string), eq(pendingPlans.status, "pending")))
      .orderBy(sql`${pendingPlans.createdAt} DESC`)
      .get();
    return row ? this._toRow(row) : null;
  }

  async save(row: Omit<PendingPlanRow, "createdAt" | "consumedAt" | "status">): Promise<void> {
    await this.db.insert(pendingPlans).values({
      id: row.id,
      userId: row.userId,
      plan: row.plan,
      cycle: row.cycle,
      currentPeriodEnd: row.currentPeriodEnd,
      externalRef: row.externalRef,
    });
  }

  async markConsumed(id: string): Promise<void> {
    await this.db
      .update(pendingPlans)
      .set({ status: "consumed", consumedAt: sql`(datetime('now'))` })
      .where(eq(pendingPlans.id, id));
  }

  private _toRow(row: typeof pendingPlans.$inferSelect): PendingPlanRow {
    return {
      id: row.id,
      userId: row.userId,
      plan: row.plan as PendingPlanRow["plan"],
      cycle: row.cycle as PendingPlanRow["cycle"],
      currentPeriodEnd: row.currentPeriodEnd,
      externalRef: row.externalRef,
      status: row.status as PendingPlanRow["status"],
      createdAt: row.createdAt,
      consumedAt: row.consumedAt,
    };
  }
}
