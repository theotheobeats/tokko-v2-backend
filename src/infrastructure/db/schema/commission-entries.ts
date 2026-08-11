import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { stores } from "./stores";
import { orders } from "./orders";

/**
 * Commission ledger — commission-path merchants (selective, 3.5% default /
 * 2.5% with custom domain). One entry per paid order; payouts (Xendit
 * disbursement, D+1/D+7) are a Phase-4 concern — this is the accrual record.
 */
export const commissionEntries = sqliteTable("commission_entries", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .references(() => stores.id),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id),
  orderAmount: integer("order_amount").notNull(), // paid order total (IDR)
  rate: real("rate").notNull(), // e.g. 3.5 = 3.5%
  fee: integer("fee").notNull(), // calculated commission (IDR)
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});
