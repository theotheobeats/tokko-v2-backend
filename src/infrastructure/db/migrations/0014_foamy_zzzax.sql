ALTER TABLE `stores` ADD `payment_online` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `stores` ADD `bank_name` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `bank_account_number` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `bank_account_name` text;