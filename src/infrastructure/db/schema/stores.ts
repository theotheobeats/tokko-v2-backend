import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
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
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});
