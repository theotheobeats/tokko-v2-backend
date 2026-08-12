CREATE TABLE `payouts` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`amount` integer NOT NULL,
	`commission` integer DEFAULT 0 NOT NULL,
	`balance_before` integer NOT NULL,
	`sweep_ref` text,
	`payout_ref` text,
	`provider_transaction_id` text,
	`status` text DEFAULT 'submitted' NOT NULL,
	`failed_reason` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action
);
