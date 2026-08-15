CREATE TABLE `access_request` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`referral_source` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `access_request_email_idx` ON `access_request` (`email`);--> statement-breakpoint
ALTER TABLE `invite_code` ADD `bound_email` text;--> statement-breakpoint
ALTER TABLE `invite_code` ADD `expires_at` integer;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_invite_code` (
	`code` text PRIMARY KEY NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`redeemed_by` text,
	`redeemed_at` integer,
	`bound_email` text,
	`expires_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_invite_code`("code", "note", "created_by", "created_at", "redeemed_by", "redeemed_at", "bound_email", "expires_at") SELECT "code", "note", "created_by", "created_at", "redeemed_by", "redeemed_at", "bound_email", "expires_at" FROM `invite_code`;--> statement-breakpoint
DROP TABLE `invite_code`;--> statement-breakpoint
ALTER TABLE `__new_invite_code` RENAME TO `invite_code`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `invite_code_redeemed_idx` ON `invite_code` (`redeemed_by`);