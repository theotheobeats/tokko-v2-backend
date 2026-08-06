DROP INDEX `pages_store_id_unique`;--> statement-breakpoint
ALTER TABLE `pages` ADD `slug` text DEFAULT 'beranda' NOT NULL;--> statement-breakpoint
ALTER TABLE `pages` ADD `title` text;--> statement-breakpoint
CREATE UNIQUE INDEX `pages_store_slug_unique` ON `pages` (`store_id`,`slug`);--> statement-breakpoint
ALTER TABLE `stores` ADD `design_tokens` text;--> statement-breakpoint
UPDATE `stores` SET `design_tokens` = (SELECT `design_tokens` FROM `pages` WHERE `pages`.`store_id` = `stores`.`id` LIMIT 1);
