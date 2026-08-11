import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { user } from "./users";

/**
 * Pending plans — a paid plan bought BEFORE the store exists (plan-selection
 * gate at signup). Paid via a provider invoice (`tokko-pre::…` external_id);
 * the webhook records the pending row here, and onboarding consumes it to
 * create the store's subscription (no trial) — or the trial starts if the
 * user picked the free path.
 */
export const pendingPlans = sqliteTable("pending_plans", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  plan: text("plan").notNull(), // "pro" | "commerce"
  cycle: text("cycle").notNull().default("monthly"), // "monthly" | "annual"
  currentPeriodEnd: text("current_period_end"), // ISO
  externalRef: text("external_ref"), // paid invoice external_id
  status: text("status").notNull().default("pending"), // pending | consumed
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  consumedAt: text("consumed_at"),
});
