CREATE TABLE `agent_share` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`recipient_email` text NOT NULL,
	`granted_via` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_share_agent_email_unique` ON `agent_share` (`agent_id`,`recipient_email`);--> statement-breakpoint
CREATE INDEX `agent_share_email_idx` ON `agent_share` (`recipient_email`);--> statement-breakpoint
ALTER TABLE `agent` ADD `public_code` text;--> statement-breakpoint
ALTER TABLE `agent` ADD `public_code_created_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_public_code_unique` ON `agent` (`public_code`);