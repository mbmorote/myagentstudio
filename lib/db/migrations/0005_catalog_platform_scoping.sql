DROP INDEX `config_def_key_unique`;--> statement-breakpoint
ALTER TABLE `config_def` ADD `platform` text DEFAULT 'claude' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `config_def_platform_key_unique` ON `config_def` (`platform`,`key`);--> statement-breakpoint
DROP INDEX `section_def_key_unique`;--> statement-breakpoint
ALTER TABLE `section_def` ADD `platform` text DEFAULT 'claude' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `section_def_platform_key_unique` ON `section_def` (`platform`,`key`);