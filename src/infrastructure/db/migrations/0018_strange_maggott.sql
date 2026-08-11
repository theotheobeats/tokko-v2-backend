CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`plan` text NOT NULL,
	`cycle` text DEFAULT 'monthly' NOT NULL,
	`price_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`current_period_end` text,
	`external_ref` text,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `stores` ADD `trial_ends_at` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `commission_rate` real;--> statement-breakpoint
ALTER TABLE `stores` ADD `ai_store_generations` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stores` ADD `ai_descriptions` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stores` ADD `custom_domain` text;