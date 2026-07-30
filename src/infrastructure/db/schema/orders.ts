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
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  items: text("items").notNull(), // JSON string array of OrderItem[]
  totalAmount: integer("total_amount").notNull(), // Rupiah
  status: text("status").notNull().default("pending"), // "pending" | "contacted" | "completed"
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});
