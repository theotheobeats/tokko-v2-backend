import { adminLogs } from "./schema";
import { eq, and, desc, count } from "drizzle-orm";
import type { DbClient } from "./drizzle";

export interface AdminLogEntry {
  adminId: string;
  /** Action key, e.g. "user.ban", "store.suspend", "ticket.reply". */
  action: string;
  /** Entity type: "user" | "store" | "order" | "ticket" | "report" | "product". */
  targetType: string;
  targetId: string;
  detail?: Record<string, unknown>;
}

/**
 * Append an admin action to the audit trail.
 *
 * Logging must never fail an admin mutation — a log write error is swallowed
 * and reported to console so the mutation itself still succeeds.
 */
export async function writeAdminLog(db: DbClient, entry: AdminLogEntry): Promise<void> {
  try {
    await db.insert(adminLogs).values({
      id: crypto.randomUUID(),
      adminId: entry.adminId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      detail: entry.detail ? JSON.stringify(entry.detail) : null,
    });
  } catch (err) {
    console.error("[admin-log] failed to write audit entry:", err);
  }
}

export interface AdminLogFilters {
  adminId?: string;
  action?: string;
  targetType?: string;
  limit?: number;
  offset?: number;
}

/** List the admin audit trail, newest first. */
export async function listAdminLogs(
  db: DbClient,
  filters: AdminLogFilters = {}
): Promise<{ logs: (typeof adminLogs.$inferSelect)[]; total: number }> {
  const conditions = [];
  if (filters.adminId) conditions.push(eq(adminLogs.adminId, filters.adminId));
  if (filters.action) conditions.push(eq(adminLogs.action, filters.action));
  if (filters.targetType) conditions.push(eq(adminLogs.targetType, filters.targetType));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const totalRow = await db.select({ count: count() }).from(adminLogs).where(where).get();
  const rows = await db
    .select()
    .from(adminLogs)
    .where(where)
    .orderBy(desc(adminLogs.createdAt))
    .limit(filters.limit ?? 100)
    .offset(filters.offset ?? 0)
    .all();

  return { logs: rows, total: totalRow?.count ?? 0 };
}
