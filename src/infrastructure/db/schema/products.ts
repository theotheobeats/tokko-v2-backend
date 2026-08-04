import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { stores } from "./stores";

/**
 * Product entity table — belongs to Store aggregate.
 */
export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .references(() => stores.id),
  name: text("name").notNull(),
  description: text("description"),
  price: integer("price").notNull(), // Rupiah (e.g., 85000 = Rp 85.000)
  imageUrl: text("image_url"), // R2 object key
  isAvailable: integer("is_available").notNull().default(1), // SQLite boolean (0/1)
  type: text("type").notNull().default("product"), // "product" | "service" | "booking"
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});
