import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { orders } from "./orders";
import { stores } from "./stores";

/**
 * Payment attempts for orders (provider: Xendit).
 *
 * One order can have several payment attempts (expired/failed → customer
 * retries with a new payment). The webhook marks the attempt paid and the
 * order's payment is confirmed.
 */
export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    amount: integer("amount").notNull(), // integer Rupiah
    currency: text("currency").notNull().default("IDR"),
    provider: text("provider").notNull().default("xendit"),
    /** Payment method the customer picked: qris | bank_transfer | ewallet | credit_card. */
    channel: text("channel"),
    /** pending | paid | failed | expired. */
    status: text("status").notNull().default("pending"),
    /** Provider invoice id (Xendit invoice id) — unique per attempt. */
    externalId: text("external_id").notNull().unique(),
    /** Provider-hosted payment page URL. */
    invoiceUrl: text("invoice_url").notNull(),
    paidAt: text("paid_at"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index("payments_order_idx").on(t.orderId),
    index("payments_store_idx").on(t.storeId),
    index("payments_status_idx").on(t.status),
  ],
);
