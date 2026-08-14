import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { stores } from "./stores";

/**
 * Settlement batches — the SingaPay clearing process.
 *
 * SingaPay completes settlement batches that move funds from a sub-account's
 * `pending_balance` (dana dalam kliring) to its `available_balance` (dana siap
 * cair). Normal settlement runs T+1..T+4 depending on the payment method; the
 * `settlement_notif_url` webhook notifies us when a batch completes.
 *
 * Attribution: `settlement.completed` payloads do not carry an account id, so
 * `storeId` stays NULL for them (admin-visible only). Refund events carry
 * `account_id`, which lets us attribute the batch to a store.
 */
export const settlements = sqliteTable("settlements", {
  id: text("id").primaryKey(),
  /** Attributed store (best-effort — see comment above). */
  storeId: text("store_id").references(() => stores.id),
  /** SingaPay sub-account id when known (refund events). */
  accountId: text("account_id"),
  /** SingaPay settlement reference (`SETTLEMENT-{merchant}-{uniqid}`) — idempotency key. */
  referenceNo: text("reference_no").notNull().unique(),
  batchTitle: text("batch_title"),
  settlementType: text("settlement_type"), // ALL | VA | QRIS | EWALLET
  method: text("method"), // balance | bank-account | auto-balance
  startDate: text("start_date"),
  endDate: text("end_date"),
  /** Total net amount of the settled transactions. */
  amount: integer("amount").notNull().default(0),
  totalAdminFee: integer("total_admin_fee").notNull().default(0),
  totalVendorFee: integer("total_vendor_fee").notNull().default(0),
  totalOurMargin: integer("total_our_margin").notNull().default(0),
  settlementFee: integer("settlement_fee").notNull().default(0),
  /** Net amount actually moved: amount − settlement_fee. */
  totalToTransfer: integer("total_to_transfer").notNull().default(0),
  totalRefunded: integer("total_refunded").notNull().default(0),
  totalTransactions: integer("total_transactions").notNull().default(0),
  status: text("status").notNull().default("completed"),
  approvedBy: text("approved_by"),
  approvedAt: text("approved_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});
