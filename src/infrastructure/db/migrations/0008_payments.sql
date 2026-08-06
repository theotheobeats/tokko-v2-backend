CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`store_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'IDR' NOT NULL,
	`provider` text DEFAULT 'xendit' NOT NULL,
	`channel` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`external_id` text NOT NULL,
	`invoice_url` text NOT NULL,
	`paid_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_external_id_unique` ON `payments` (`external_id`);--> statement-breakpoint
CREATE INDEX `payments_order_idx` ON `payments` (`order_id`);--> statement-breakpoint
CREATE INDEX `payments_store_idx` ON `payments` (`store_id`);--> statement-breakpoint
CREATE INDEX `payments_status_idx` ON `payments` (`status`);