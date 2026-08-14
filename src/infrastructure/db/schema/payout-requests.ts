import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { stores } from "./stores";
import { payouts } from "./payouts";

/**
 * Payout requests — merchant-initiated, admin-approved.
 *
 * Merchants request a pencairan of their ready funds (available balance minus
 * platform commission). An admin reviews the request; approval executes the
 * real money movement (commission sweep + bank disbursement via RunPayout) and
 * links the resulting `payouts` row. Statuses:
 *   pending   — merchant requested, awaiting admin review
 *   approved  — admin approved but execution failed (retryable) or not yet run
 *   paid      — RunPayout executed; `payoutId` links the payout row
 *   rejected  — admin rejected (decisionNote holds the reason)
 *   cancelled — merchant cancelled their own pending request
 */
export const payoutRequests = sqliteTable("payout_requests", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .references(() => stores.id),
  /** Requested net amount (IDR) — snapshot of ready funds at request time. */
  amount: integer("amount").notNull(),
  /** Platform commission owed at request time. */
  commission: integer("commission").notNull().default(0),
  /** Available balance snapshot at request time. */
  balanceBefore: integer("balance_before").notNull().default(0),
  status: text("status").notNull().default("pending"), // pending | approved | paid | rejected | cancelled
  /** Optional merchant note attached to the request. */
  note: text("note"),
  /** Linked payout row once executed. */
  payoutId: text("payout_id").references(() => payouts.id),
  reviewedBy: text("reviewed_by"),
  reviewedAt: text("reviewed_at"),
  /** Admin decision note / execution error for retryable approvals. */
  decisionNote: text("decision_note"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});
