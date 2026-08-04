CREATE TABLE `regions` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`level` integer NOT NULL,
	`parent_code` text,
	`kodepos` text
);
--> statement-breakpoint
CREATE INDEX `idx_regions_parent` ON `regions` (`parent_code`);--> statement-breakpoint
CREATE INDEX `idx_regions_level` ON `regions` (`level`);