CREATE TABLE `payout_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`amount` integer NOT NULL,
	`commission` integer DEFAULT 0 NOT NULL,
	`balance_before` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`note` text,
	`payout_id` text,
	`reviewed_by` text,
	`reviewed_at` text,
	`decision_note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payout_id`) REFERENCES `payouts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text,
	`account_id` text,
	`reference_no` text NOT NULL,
	`batch_title` text,
	`settlement_type` text,
	`method` text,
	`start_date` text,
	`end_date` text,
	`amount` integer DEFAULT 0 NOT NULL,
	`total_admin_fee` integer DEFAULT 0 NOT NULL,
	`total_vendor_fee` integer DEFAULT 0 NOT NULL,
	`total_our_margin` integer DEFAULT 0 NOT NULL,
	`settlement_fee` integer DEFAULT 0 NOT NULL,
	`total_to_transfer` integer DEFAULT 0 NOT NULL,
	`total_refunded` integer DEFAULT 0 NOT NULL,
	`total_transactions` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settlements_reference_no_unique` ON `settlements` (`reference_no`);