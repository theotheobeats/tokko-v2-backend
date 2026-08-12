import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { stores } from "./stores";

/**
 * Payouts — merchant fund payouts from their SingaPay sub-account to their
 * bank, with the platform commission swept separately (account-transfer).
 * Money always moves from the merchant's OWN SingaPay account; we never hold
 * merchant funds. Status: submitted | settled | failed.
 */
export const payouts = sqliteTable("payouts", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .references(() => stores.id),
  /** Net amount disbursed to the merchant's bank (excl. commission + fee). */
  amount: integer("amount").notNull(),
  /** Commission swept to the platform account. */
  commission: integer("commission").notNull().default(0),
  /** Merchant sub-account available balance before the payout. */
  balanceBefore: integer("balance_before").notNull(),
  /** Provider transaction id of the commission sweep (account-transfer). */
  sweepRef: text("sweep_ref"),
  /** Merchant reference of the disbursement (idempotency key). */
  payoutRef: text("payout_ref"),
  /** Provider disbursement transaction id. */
  providerTransactionId: text("provider_transaction_id"),
  status: text("status").notNull().default("submitted"), // submitted | settled | failed
  failedReason: text("failed_reason"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});
