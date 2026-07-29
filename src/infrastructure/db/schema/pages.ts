import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { stores } from "./stores";

/**
 * Page entity table — one page per store.
 */
export const pages = sqliteTable("pages", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .unique() // One page per store
    .references(() => stores.id),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
});
