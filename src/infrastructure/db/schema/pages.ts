import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { stores } from "./stores";

/**
 * Page entity table — a store can have multiple pages (free-form).
 *
 * `slug` is the URL segment (e.g. "tentang", "produk"); "beranda" is the
 * home page. The composite unique (store_id, slug) replaces the old
 * one-page-per-store constraint.
 *
 * The visual theme lives on the STORE (stores.design_tokens), shared by all
 * pages. `design_tokens` here is kept only for back-compat and is unused.
 */
export const pages = sqliteTable(
  "pages",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    slug: text("slug").notNull().default("beranda"),
    title: text("title"),
    designTokens: text("design_tokens"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [uniqueIndex("pages_store_slug_unique").on(t.storeId, t.slug)],
);
