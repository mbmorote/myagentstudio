CREATE TABLE `email_log` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`to_email` text NOT NULL,
	`subject` text NOT NULL,
	`status` text NOT NULL,
	`provider_message_id` text,
	`error` text,
	`duration_ms` integer NOT NULL,
	`related_type` text,
	`related_id` text,
	`triggered_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_log_created_idx` ON `email_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `email_log_related_idx` ON `email_log` (`related_type`,`related_id`);