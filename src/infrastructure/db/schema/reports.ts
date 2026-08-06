import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { user } from "./users";
import { stores } from "./stores";

/**
 * Content-moderation reports — submitted by visitors against a store (or one
 * of its products/sections). Admins review and resolve with an action.
 */
export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    reporterId: text("reporter_id").references(() => user.id),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    /** "store" | "product" | "section" | "user". */
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    /** "spam" | "inappropriate" | "fraud" | "copyright" | "other". */
    reason: text("reason").notNull(),
    details: text("details"),
    /** "open" | "reviewing" | "resolved" | "dismissed". */
    status: text("status").notNull().default("open"),
    /** "suspended" | "warned" | "dismissed" — set when resolved. */
    resolution: text("resolution"),
    resolvedBy: text("resolved_by"),
    resolvedAt: text("resolved_at"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index("reports_status_idx").on(t.status),
    index("reports_store_idx").on(t.storeId),
  ],
);
