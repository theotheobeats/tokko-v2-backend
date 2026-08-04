import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { stores } from "./stores";

/**
 * Order aggregate root table.
 */
export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .references(() => stores.id),
  orderCode: text("order_code"), // human-friendly ref, e.g. TK-8F3K2
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  items: text("items").notNull(), // JSON string array of OrderItem[]
  totalAmount: integer("total_amount").notNull(), // Rupiah
  status: text("status").notNull().default("pending"), // "pending" | "contacted" | "completed"
  notes: text("notes"),
  shippingAddress: text("shipping_address"), // required for physical product orders
  trackingNumber: text("tracking_number"), // nomor resi (product orders)
  courier: text("courier"), // jasa kirim
  paymentConfirmed: integer("payment_confirmed").notNull().default(0), // SQLite boolean (0/1)
  paymentNote: text("payment_note"),
  queueNumber: text("queue_number"), // nomor antrian (booking orders)
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});
