CREATE TABLE `llm_call_log` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`provider` text DEFAULT 'anthropic' NOT NULL,
	`agent_id` text,
	`agent_label` text,
	`dry_run` integer NOT NULL,
	`model` text NOT NULL,
	`request_payload` text NOT NULL,
	`response_payload` text,
	`error` text,
	`duration_ms` integer NOT NULL,
	`usage` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `llm_call_log_created_idx` ON `llm_call_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `llm_call_log_kind_idx` ON `llm_call_log` (`kind`);--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
