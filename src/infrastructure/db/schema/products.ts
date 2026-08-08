import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { stores } from "./stores";

/**
 * Product entity table — belongs to Store aggregate.
 */
export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .references(() => stores.id),
  name: text("name").notNull(),
  description: text("description"),
  price: integer("price").notNull(), // Rupiah (e.g., 85000 = Rp 85.000)
  imageUrl: text("image_url"), // R2 object key — legacy single image (cover fallback)
  images: text("images"), // JSON array of R2 object keys — gallery
  salePrice: integer("sale_price"), // Rupiah — discounted price, null = no sale
  slug: text("slug"), // URL slug, unique per store (null = use id in URLs)
  categoryId: text("category_id"), // FK to product_categories
  stock: integer("stock"), // available units; null = unlimited, 0 = sold out
  weight: integer("weight"), // grams — required for Biteship shipping rates
  isAvailable: integer("is_available").notNull().default(1), // SQLite boolean (0/1)
  type: text("type").notNull().default("product"), // "product" | "service" | "booking"
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

/**
 * Product category — belongs to Store aggregate (soft grouping for the
 * storefront; products reference categories via products.categoryId).
 */
export const productCategories = sqliteTable("product_categories", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .references(() => stores.id),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

/**
 * Product variant — e.g. size/color. Price null = inherit product price.
 * Belongs to Product aggregate (replaced on product save).
 */
export const productVariants = sqliteTable("product_variants", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  name: text("name").notNull(),
  price: integer("price"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});
