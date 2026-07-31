CREATE TABLE `oauth_account` (
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider_email` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`provider`, `provider_account_id`)
);
--> statement-breakpoint
CREATE INDEX `oauth_account_user_idx` ON `oauth_account` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_account_user_provider_unique` ON `oauth_account` (`user_id`,`provider`);