--> statement-breakpoint
ALTER TABLE `products` ADD `weight` integer;--> statement-breakpoint
ALTER TABLE `stores` ADD `origin_address` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `origin_postal_code` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `origin_contact_name` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `origin_contact_phone` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `origin_latitude` real;--> statement-breakpoint
ALTER TABLE `stores` ADD `origin_longitude` real;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_option` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_fee` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_courier` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_service` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_duration` text;
