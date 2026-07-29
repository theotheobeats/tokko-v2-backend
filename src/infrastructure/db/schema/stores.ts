import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
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
  status: text("status").notNull().default("draft"), // "draft" | "published"
  heroImageUrl: text("hero_image_url"),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
});
