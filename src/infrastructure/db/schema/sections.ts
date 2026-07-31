import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { pages } from "./pages";

/**
 * Section value object table — belongs to Page entity.
 *
 * `data` holds the structured section payload as JSON:
 *   { "variant": "split", "content": { "title": "...", ... } }
 * The frontend maps (type + variant) → a designed component fed by content.
 */
export const sections = sqliteTable("sections", {
  id: text("id").primaryKey(),
  pageId: text("page_id")
    .notNull()
    .references(() => pages.id),
  type: text("type").notNull(), // "hero" | "about" | "product-grid" | "testimonial" | "cta" | "contact" | "faq"
  data: text("data").notNull(), // JSON string: { variant, content }
  sortOrder: integer("sort_order").notNull().default(0),
});
