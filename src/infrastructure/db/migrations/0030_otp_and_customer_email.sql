CREATE TABLE `otp_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`purpose` text NOT NULL,
	`code_hash` text NOT NULL,
	`attempt_id` text NOT NULL,
	`session_cookie` text,
	`expires_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `otp_codes_attempt_id_unique` ON `otp_codes` (`attempt_id`);--> statement-breakpoint
ALTER TABLE `payments` ADD `customer_email` text;