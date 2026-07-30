import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { pages } from "./pages";

/**
 * Section value object table — belongs to Page entity.
 */
export const sections = sqliteTable("sections", {
  id: text("id").primaryKey(),
  pageId: text("page_id")
    .notNull()
    .references(() => pages.id),
  type: text("type").notNull(), // "hero" | "about" | "product-grid" | "testimonial" | "cta" | "contact" | "faq"
  data: text("data").notNull(), // JSON string of slots — parsed at app level
  template: text("template").notNull().default("<div>{{content}}</div>"), // HTML with {{slotKey}} placeholders
  sortOrder: integer("sort_order").notNull().default(0),
});
