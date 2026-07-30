import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { stores } from "./stores";

export const pages = sqliteTable("pages", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .unique()
    .references(() => stores.id),
  designTokens: text("design_tokens"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});
