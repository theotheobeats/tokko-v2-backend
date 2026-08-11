/**
 * D1 Subscription Repository.
 */

import { eq, and, sql, desc } from "drizzle-orm";
import type { EntityId } from "../../domain/shared/types";
import { Subscription, type SubscriptionProps } from "../../domain/plan/subscription";
import type { DbClient } from "../db/drizzle";
import { subscriptions } from "../db/schema";

export interface SubscriptionRepository {
  findActiveByStoreId(storeId: EntityId): Promise<Subscription | null>;
  listByStoreId(storeId: EntityId): Promise<Subscription[]>;
  listAll(): Promise<Subscription[]>;
  save(subscription: Subscription): Promise<void>;
}

export class D1SubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly db: DbClient) {}

  async findActiveByStoreId(storeId: EntityId): Promise<Subscription | null> {
    const row = await this.db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.storeId, storeId as string), eq(subscriptions.status, "active")))
      .orderBy(desc(subscriptions.startedAt))
      .get();
    return row ? this._toDomain(row) : null;
  }

  async listByStoreId(storeId: EntityId): Promise<Subscription[]> {
    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.storeId, storeId as string))
      .orderBy(desc(subscriptions.startedAt))
      .all();
    return rows.map((r) => this._toDomain(r));
  }

  async listAll(): Promise<Subscription[]> {
    const rows = await this.db
      .select()
      .from(subscriptions)
      .orderBy(desc(subscriptions.startedAt))
      .all();
    return rows.map((r) => this._toDomain(r));
  }

  async save(subscription: Subscription): Promise<void> {
    const props = subscription.toJSON();
    const existing = await this.db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.id, subscription.id))
      .get();

    if (existing) {
      await this.db
        .update(subscriptions)
        .set({
          plan: props.plan,
          cycle: props.cycle,
          priceId: props.priceId,
          status: props.status,
          currentPeriodEnd: props.currentPeriodEnd,
          externalRef: props.externalRef,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(eq(subscriptions.id, subscription.id));
    } else {
      await this.db.insert(subscriptions).values({
        id: props.id,
        storeId: props.storeId,
        plan: props.plan,
        cycle: props.cycle,
        priceId: props.priceId,
        status: props.status,
        currentPeriodEnd: props.currentPeriodEnd,
        externalRef: props.externalRef,
        startedAt: props.startedAt,
        updatedAt: props.updatedAt,
      });
    }
  }

  private _toDomain(row: typeof subscriptions.$inferSelect): Subscription {
    return Subscription.from({
      id: row.id,
      storeId: row.storeId,
      plan: row.plan as SubscriptionProps["plan"],
      cycle: row.cycle as SubscriptionProps["cycle"],
      priceId: row.priceId,
      status: row.status as SubscriptionProps["status"],
      currentPeriodEnd: row.currentPeriodEnd,
      externalRef: row.externalRef,
      startedAt: row.startedAt,
      updatedAt: row.updatedAt,
    });
  }
}
