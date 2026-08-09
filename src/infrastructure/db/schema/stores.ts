import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { user } from "./users";

/**
 * Store aggregate root table.
 */
export const stores = sqliteTable("stores", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  name: text("name").notNull(),
  subdomain: text("subdomain").notNull().unique(),
  description: text("description"),
  businessType: text("business_type").notNull(),
  aestheticPreference: text("aesthetic_preference").notNull(),
  whatsappNumber: text("whatsapp_number").notNull(),
  status: text("status").notNull().default("draft"),
  heroImageUrl: text("hero_image_url"),
  suspendedAt: text("suspended_at"),
  suspendedReason: text("suspended_reason"),
  /** Site-wide visual theme (design tokens), shared by all pages. */
  designTokens: text("design_tokens"),
  // Shipping origin (pickup location) — used by Biteship rates/orders.
  originAddress: text("origin_address"),
  originPostalCode: text("origin_postal_code"),
  originContactName: text("origin_contact_name"),
  originContactPhone: text("origin_contact_phone"),
  originLatitude: real("origin_latitude"),
  originLongitude: real("origin_longitude"),
  paymentOnline: integer("payment_online").notNull().default(1), // SQLite boolean (0/1) — Xendit online payments
  bankName: text("bank_name"), // manual transfer — bank name
  bankAccountNumber: text("bank_account_number"), // manual transfer — account number
  bankAccountName: text("bank_account_name"), // manual transfer — account holder
  enabledPaymentMethods: text("enabled_payment_methods"), // JSON array of catalog ids — null = all
  enabledCouriers: text("enabled_couriers"), // JSON array of courier codes — null = all
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});
