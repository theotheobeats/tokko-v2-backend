/**
 * D1 Order Repository.
 */

import { eq, and, sql } from "drizzle-orm";
import type { EntityId } from "../../domain/shared/types";
import { Order, type OrderProps } from "../../domain/order/order";
import type { OrderItemProps } from "../../domain/order/order-item";
import type { OrderStatus } from "../../domain/order/types";
import type { DbClient } from "../db/drizzle";
import { orders } from "../db/schema";
import { generateOrderCode } from "../../domain/order/rules";

export interface OrderRepository {
  findById(id: EntityId): Promise<Order | null>;
  findByStoreId(storeId: EntityId, filters?: { status?: OrderStatus; limit?: number; offset?: number }): Promise<Order[]>;
  countByStoreId(storeId: EntityId, filters?: { status?: OrderStatus }): Promise<{ all: number; pending: number; contacted: number; completed: number }>;
  save(order: Order): Promise<void>;
  /** Admin: list orders across all stores. */
  listAll(filters?: { status?: OrderStatus; storeId?: EntityId; limit?: number; offset?: number }): Promise<Order[]>;
  /** Admin: per-status counts across all stores. */
  countAll(): Promise<Record<string, number>>;
  /** Admin: total GMV (sum of total_amount). */
  sumTotalAll(): Promise<number>;
  /** Admin: orders + GMV created within the last N days. */
  since(daysAgo: number): Promise<{ orders: number; gmv: number }>;
  /** Admin: remove every order of a store (store deletion cascade). */
  deleteByStoreId(storeId: EntityId): Promise<void>;
}

export class D1OrderRepository implements OrderRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: EntityId): Promise<Order | null> {
    const row = await this.db
      .select()
      .from(orders)
      .where(eq(orders.id, id as string))
      .get();
    return row ? this._toDomain(row) : null;
  }

  async findByStoreId(
    storeId: EntityId,
    filters?: { status?: OrderStatus; limit?: number; offset?: number }
  ): Promise<Order[]> {
    const where = filters?.status
      ? and(eq(orders.storeId, storeId as string), eq(orders.status, filters.status))
      : eq(orders.storeId, storeId as string);

    const rows = await this.db
      .select()
      .from(orders)
      .where(where)
      .orderBy(sql`${orders.createdAt} DESC`)
      .limit(filters?.limit ?? 50)
      .offset(filters?.offset ?? 0)
      .all();

    return rows.map((r) => this._toDomain(r));
  }

  async countByStoreId(storeId: EntityId): Promise<{ all: number; pending: number; contacted: number; completed: number }> {
    const { count } = await import("drizzle-orm");

    const [allRows, pendingRows, contactedRows, completedRows] = await Promise.all([
      this.db.select({ count: count() }).from(orders).where(eq(orders.storeId, storeId as string)).get(),
      this.db.select({ count: count() }).from(orders).where(and(eq(orders.storeId, storeId as string), eq(orders.status, "pending"))).get(),
      this.db.select({ count: count() }).from(orders).where(and(eq(orders.storeId, storeId as string), eq(orders.status, "contacted"))).get(),
      this.db.select({ count: count() }).from(orders).where(and(eq(orders.storeId, storeId as string), eq(orders.status, "completed"))).get(),
    ]);

    return {
      all: allRows?.count ?? 0,
      pending: pendingRows?.count ?? 0,
      contacted: contactedRows?.count ?? 0,
      completed: completedRows?.count ?? 0,
    };
  }

  async save(order: Order): Promise<void> {
    const data = this._toRow(order.toJSON());
    const existing = await this.findById(order.id);

    if (existing) {
      await this.db.update(orders)
        .set(data)
        .where(eq(orders.id, order.id as string));
    } else {
      await this.db.insert(orders).values(data);
    }
  }

  // -----------------------------------------------------------------------
  // Admin queries (all stores)
  // -----------------------------------------------------------------------

  async listAll(filters: { status?: OrderStatus; storeId?: EntityId; limit?: number; offset?: number } = {}): Promise<Order[]> {
    const conditions = [];
    if (filters.status) conditions.push(eq(orders.status, filters.status));
    if (filters.storeId) conditions.push(eq(orders.storeId, filters.storeId as string));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await this.db
      .select()
      .from(orders)
      .where(where)
      .orderBy(sql`${orders.createdAt} DESC`)
      .limit(filters.limit ?? 50)
      .offset(filters.offset ?? 0)
      .all();

    return rows.map((r) => this._toDomain(r));
  }

  async countAll(): Promise<Record<string, number>> {
    const { count } = await import("drizzle-orm");
    const rows = await this.db
      .select({ status: orders.status, count: count() })
      .from(orders)
      .groupBy(orders.status)
      .all();
    const out: Record<string, number> = { pending: 0, contacted: 0, completed: 0, all: 0 };
    for (const r of rows) {
      out[r.status] = r.count;
      out.all += r.count;
    }
    return out;
  }

  async sumTotalAll(): Promise<number> {
    const { sum } = await import("drizzle-orm");
    const row = await this.db
      .select({ total: sum(orders.totalAmount) })
      .from(orders)
      .get();
    return Number(row?.total ?? 0);
  }

  async since(daysAgo: number): Promise<{ orders: number; gmv: number }> {
    const { count, sum } = await import("drizzle-orm");
    const cutoff = sql`datetime('now', '-${sql.raw(String(daysAgo))} days')`;
    const row = await this.db
      .select({ orders: count(), gmv: sum(orders.totalAmount) })
      .from(orders)
      .where(sql`${orders.createdAt} >= ${cutoff}`)
      .get();
    return { orders: row?.orders ?? 0, gmv: Number(row?.gmv ?? 0) };
  }

  /** Admin: remove every order of a store (store deletion cascade). */
  async deleteByStoreId(storeId: EntityId): Promise<void> {
    await this.db.delete(orders).where(eq(orders.storeId, storeId as string));
  }

  private _toDomain(row: typeof orders.$inferSelect): Order {
    return Order.from({
      id: row.id as EntityId,
      storeId: row.storeId as EntityId,
      orderCode: row.orderCode ?? generateOrderCode(),
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      items: JSON.parse(row.items) as OrderItemProps[],
      totalAmount: row.totalAmount,
      status: row.status as OrderStatus,
      notes: row.notes,
      shippingAddress: row.shippingAddress,
      trackingNumber: row.trackingNumber,
      courier: row.courier,
      paymentConfirmed: row.paymentConfirmed === 1,
      paymentNote: row.paymentNote,
      queueNumber: row.queueNumber,
      createdAt: row.createdAt,
    });
  }

  private _toRow(props: ReturnType<Order["toJSON"]>) {
    return {
      id: props.id as string,
      storeId: props.storeId as string,
      orderCode: props.orderCode,
      customerName: props.customerName,
      customerPhone: props.customerPhone,
      items: JSON.stringify(props.items),
      totalAmount: props.totalAmount,
      status: props.status,
      notes: props.notes,
      shippingAddress: props.shippingAddress,
      trackingNumber: props.trackingNumber,
      courier: props.courier,
      paymentConfirmed: props.paymentConfirmed ? 1 : 0,
      paymentNote: props.paymentNote,
      queueNumber: props.queueNumber,
    };
  }
}
