import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Admin action audit trail.
 *
 * Every admin mutation writes a row: who did what, to which entity, when.
 * This is the accountability record for content moderation (who suspended a
 * store, who banned a user, why) — cheap insurance for a moderation feature.
 */
export const adminLogs = sqliteTable(
  "admin_logs",
  {
    id: text("id").primaryKey(),
    adminId: text("admin_id").notNull(),
    /** Action key, e.g. "user.ban", "user.role", "store.suspend", "store.delete", "ticket.reply", "report.resolve". */
    action: text("action").notNull(),
    /** Entity type: "user" | "store" | "order" | "ticket" | "report" | "product". */
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    /** Optional JSON string with extra context (reason, before/after, …). */
    detail: text("detail"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (t) => [
    index("admin_logs_admin_idx").on(t.adminId),
    index("admin_logs_target_idx").on(t.targetType, t.targetId),
  ],
);
