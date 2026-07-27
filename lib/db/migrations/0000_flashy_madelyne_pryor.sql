CREATE TABLE `agent` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`source` text NOT NULL,
	`platform` text DEFAULT 'claude' NOT NULL,
	`split_level` integer DEFAULT 1 NOT NULL,
	`raw_source_snapshot` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_name_unique` ON `agent` (`name`);--> statement-breakpoint
CREATE TABLE `agent_config` (
	`agent_id` text NOT NULL,
	`prop_key` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`agent_id`, `prop_key`)
);
--> statement-breakpoint
CREATE INDEX `agent_config_agent_idx` ON `agent_config` (`agent_id`);--> statement-breakpoint
CREATE TABLE `agent_section` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`section_key` text NOT NULL,
	`heading` text,
	`content` text DEFAULT '' NOT NULL,
	`order` integer NOT NULL,
	`version` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_section_agent_idx` ON `agent_section` (`agent_id`);--> statement-breakpoint
CREATE TABLE `agent_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_snapshot_agent_idx` ON `agent_snapshot` (`agent_id`);--> statement-breakpoint
CREATE TABLE `config_def` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`datatype` text NOT NULL,
	`allowed_values` text,
	`required` integer DEFAULT false NOT NULL,
	`is_core` integer DEFAULT false NOT NULL,
	`exportable` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `config_def_key_unique` ON `config_def` (`key`);--> statement-breakpoint
CREATE TABLE `group` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_name_unique` ON `group` (`name`);--> statement-breakpoint
CREATE TABLE `membership` (
	`agent_id` text NOT NULL,
	`group_id` text NOT NULL,
	PRIMARY KEY(`agent_id`, `group_id`)
);
--> statement-breakpoint
CREATE TABLE `section_def` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`default_heading` text NOT NULL,
	`is_core` integer DEFAULT false NOT NULL,
	`default_order` integer NOT NULL,
	`template` text DEFAULT '' NOT NULL,
	`help_text` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `section_def_key_unique` ON `section_def` (`key`);--> statement-breakpoint
CREATE TABLE `section_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`content` text NOT NULL,
	`author` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `section_revision_section_idx` ON `section_revision` (`section_id`);