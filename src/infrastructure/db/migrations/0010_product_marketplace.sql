--> statement-breakpoint
ALTER TABLE `products` ADD `slug` text;--> statement-breakpoint
ALTER TABLE `products` ADD `sale_price` integer;--> statement-breakpoint
ALTER TABLE `products` ADD `images` text;--> statement-breakpoint
ALTER TABLE `products` ADD `category_id` text;--> statement-breakpoint
UPDATE `products` SET `images` = '["' || `image_url` || '"]' WHERE `image_url` IS NOT NULL AND `images` IS NULL;--> statement-breakpoint
CREATE TABLE `product_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` text NOT NULL DEFAULT (datetime('now'))
);--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`price` integer,
	`sort_order` integer NOT NULL DEFAULT 0,
	`created_at` text NOT NULL DEFAULT (datetime('now'))
);--> statement-breakpoint
CREATE INDEX `product_variants_product_idx` ON `product_variants` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_store_slug_unique` ON `products` (`store_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_categories_store_slug_unique` ON `product_categories` (`store_id`,`slug`);
