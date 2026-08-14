/**
 * D1 Payment Repository.
 */

import { eq, and, count, sql } from "drizzle-orm";
import type { EntityId } from "../../domain/shared/types";
import { Payment } from "../../domain/payment/payment";
import type { PaymentStatus, PaymentProvider } from "../../domain/payment/types";
import type { DbClient } from "../db/drizzle";
import { payments } from "../db/schema";

export interface PaymentRepository {
  findById(id: EntityId): Promise<Payment | null>;
  findByExternalId(externalId: string): Promise<Payment | null>;
  findByOrderId(orderId: EntityId): Promise<Payment[]>;
  listByStoreId(storeId: EntityId, filters?: { status?: PaymentStatus; limit?: number; offset?: number }): Promise<{ payments: Payment[]; total: number }>;
  /** All pending attempts — admin payment reconciliation. */
  listPending(): Promise<Payment[]>;
  save(payment: Payment): Promise<void>;
}

export class D1PaymentRepository implements PaymentRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: EntityId): Promise<Payment | null> {
    const row = await this.db
      .select()
      .from(payments)
      .where(eq(payments.id, id as string))
      .get();
    return row ? this._toDomain(row) : null;
  }

  async findByExternalId(externalId: string): Promise<Payment | null> {
    const row = await this.db
      .select()
      .from(payments)
      .where(eq(payments.externalId, externalId))
      .get();
    return row ? this._toDomain(row) : null;
  }

  async findByOrderId(orderId: EntityId): Promise<Payment[]> {
    const rows = await this.db
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId as string))
      .orderBy(sql`${payments.createdAt} ASC`)
      .all();
    return rows.map((r) => this._toDomain(r));
  }

  async listByStoreId(
    storeId: EntityId,
    filters: { status?: PaymentStatus; limit?: number; offset?: number } = {}
  ): Promise<{ payments: Payment[]; total: number }> {
    const conditions = [eq(payments.storeId, storeId as string)];
    if (filters.status) conditions.push(eq(payments.status, filters.status));
    const where = and(...conditions);

    const totalRow = await this.db
      .select({ count: count() })
      .from(payments)
      .where(where)
      .get();

    const rows = await this.db
      .select()
      .from(payments)
      .where(where)
      .orderBy(sql`${payments.createdAt} DESC`)
      .limit(filters.limit ?? 50)
      .offset(filters.offset ?? 0)
      .all();

    return {
      payments: rows.map((r) => this._toDomain(r)),
      total: totalRow?.count ?? 0,
    };
  }

  /** All pending attempts — admin payment reconciliation. */
  async listPending(): Promise<Payment[]> {
    const rows = await this.db
      .select()
      .from(payments)
      .where(eq(payments.status, "pending"))
      .orderBy(sql`${payments.createdAt} ASC`)
      .all();
    return rows.map((r) => this._toDomain(r));
  }

  async save(payment: Payment): Promise<void> {
    const props = payment.toJSON();
    const existing = await this.findById(payment.id);

    if (existing) {
      await this.db
        .update(payments)
        .set({
          status: props.status,
          paidAt: props.paidAt,
          updatedAt: props.updatedAt,
        })
        .where(eq(payments.id, props.id as string));
    } else {
      await this.db.insert(payments).values({
        id: props.id as string,
        orderId: props.orderId as string,
        storeId: props.storeId as string,
        amount: props.amount,
        currency: props.currency,
        provider: props.provider,
        channel: props.channel,
        customerEmail: props.customerEmail,
        status: props.status,
        externalId: props.externalId,
        invoiceUrl: props.invoiceUrl,
        paidAt: props.paidAt,
      });
    }
  }

  private _toDomain(row: typeof payments.$inferSelect): Payment {
    return Payment.from({
      id: row.id as EntityId,
      orderId: row.orderId as EntityId,
      storeId: row.storeId as EntityId,
      amount: row.amount,
      currency: row.currency,
      provider: row.provider as PaymentProvider,
      channel: row.channel,
      customerEmail: row.customerEmail,
      status: row.status as PaymentStatus,
      externalId: row.externalId,
      invoiceUrl: row.invoiceUrl,
      paidAt: row.paidAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
