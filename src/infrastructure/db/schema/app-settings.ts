import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * App-wide settings (key-value). Currently holds the active payment provider
 * (`payment_provider`: "singapay" | "xendit") — switched from the admin
 * panel, no redeploy needed. See infrastructure/payments/registry.ts.
 */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});
