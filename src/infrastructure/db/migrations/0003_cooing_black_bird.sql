ALTER TABLE `orders` ADD `order_code` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_address` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `tracking_number` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `courier` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_confirmed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_note` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `queue_number` text;--> statement-breakpoint
ALTER TABLE `products` ADD `type` text DEFAULT 'product' NOT NULL;