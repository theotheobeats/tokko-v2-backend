import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { stores } from "./stores";

/**
 * Subscriptions — paid tier state per store (Phase 1: manual/admin-managed;
 * Phase 3: Xendit recurring / xenPlatform → webhook → auto-activate).
 *
 * Effective tier resolution (see domain/plan):
 *   - active subscription → plan (pro | commerce)
 *   - else stores.trial_ends_at in the future → trial
 *   - else → none (store paused by the trial-expiry cron, Phase 2)
 */
export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .references(() => stores.id),
  plan: text("plan").notNull(), // "pro" | "commerce"
  cycle: text("cycle").notNull().default("monthly"), // "monthly" | "annual"
  priceId: text("price_id"), // billing price ref (Phase 3)
  status: text("status").notNull().default("active"), // "active" | "expired" | "canceled"
  currentPeriodEnd: text("current_period_end"), // ISO — when the paid period ends
  externalRef: text("external_ref"), // external billing reference (Phase 3)
  renewalInvoiceExternalId: text("renewal_invoice_external_id"), // pending auto-renewal invoice (Phase 3)
  // Next-term plan change (paid now, applied at current_period_end):
  pendingPlan: text("pending_plan"), // pro | commerce — takes effect next term
  pendingCycle: text("pending_cycle"), // monthly | annual
  startedAt: text("started_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});
