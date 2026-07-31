-- 1 ── new tables (no dependencies, no data)
CREATE TABLE `user` (
  `id` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL,
  `password_hash` text NOT NULL,
  `role` text DEFAULT 'user' NOT NULL,
  `share_logs_with_admin` integer DEFAULT 0 NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);
--> statement-breakpoint
CREATE TABLE `invite_code` (
  `code` text PRIMARY KEY NOT NULL,
  `note` text,
  `created_by` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `redeemed_by` text,
  `redeemed_at` integer
);
--> statement-breakpoint
CREATE INDEX `invite_code_redeemed_idx` ON `invite_code` (`redeemed_by`);
--> statement-breakpoint

-- 2 ── additive NULLABLE columns (always legal on a populated SQLite table)
ALTER TABLE `agent` ADD `owner_id` text;
--> statement-breakpoint
ALTER TABLE `group` ADD `owner_id` text;
--> statement-breakpoint
ALTER TABLE `llm_call_log` ADD `user_id` text;
--> statement-breakpoint
-- NOT NULL *with* a default IS legal on a populated table — it is NOT NULL *without*
-- one that SQLite rejects. Existing rows get 0, and are exempted from redaction by the
-- user_id IS NULL rule, not by this flag (§4.3).
ALTER TABLE `llm_call_log` ADD `shared_with_admin` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `llm_call_log_user_created_idx` ON `llm_call_log` (`user_id`,`created_at`);
--> statement-breakpoint

-- 3 ── bootstrap owner, created ONLY if there is legacy data needing an owner.
--      password_hash '' is the "no password set" sentinel (§3.7); SQL cannot hash.
--      share_logs_with_admin is written explicitly (0) rather than left to the default:
--      it is moot for the admin — who always sees their own rows — and an explicit 0
--      keeps "consent is never implied" true even in hand-authored SQL.
INSERT INTO `user` (`id`,`email`,`password_hash`,`role`,`share_logs_with_admin`,`created_at`)
SELECT '00000000-0000-4000-8000-00000000b007','bootstrap@localhost','','admin',0,unixepoch()
WHERE (SELECT COUNT(*) FROM `agent`) + (SELECT COUNT(*) FROM `group`) > 0;
--> statement-breakpoint

-- 4 ── backfill
UPDATE `agent` SET `owner_id` = '00000000-0000-4000-8000-00000000b007' WHERE `owner_id` IS NULL;
--> statement-breakpoint
UPDATE `group` SET `owner_id` = '00000000-0000-4000-8000-00000000b007' WHERE `owner_id` IS NULL;
--> statement-breakpoint

-- 5 ── rebuild to enforce NOT NULL + the composite unique index.
--      Columns are listed EXPLICITLY on both sides — never `INSERT … SELECT *`.
--      DROP TABLE also drops `agent_name_unique`, so no explicit DROP INDEX is needed.
CREATE TABLE `__new_agent` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_id` text NOT NULL,
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
INSERT INTO `__new_agent`
  (`id`,`owner_id`,`name`,`description`,`source`,`platform`,`split_level`,`raw_source_snapshot`,`created_at`,`updated_at`)
SELECT
   `id`,`owner_id`,`name`,`description`,`source`,`platform`,`split_level`,`raw_source_snapshot`,`created_at`,`updated_at`
FROM `agent`;
--> statement-breakpoint
DROP TABLE `agent`;
--> statement-breakpoint
ALTER TABLE `__new_agent` RENAME TO `agent`;
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_owner_name_unique` ON `agent` (`owner_id`,`name`);
--> statement-breakpoint
CREATE INDEX `agent_owner_idx` ON `agent` (`owner_id`);
--> statement-breakpoint
-- identical five-statement sequence for `group`
--   (`id`,`owner_id`,`name`,`parent_id`,`created_at`) →
--   `group_owner_name_unique` (owner_id,name) + `group_owner_idx` (owner_id)
CREATE TABLE `__new_group` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_id` text NOT NULL,
  `name` text NOT NULL,
  `parent_id` text,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_group`
  (`id`,`owner_id`,`name`,`parent_id`,`created_at`)
SELECT
   `id`,`owner_id`,`name`,`parent_id`,`created_at`
FROM `group`;
--> statement-breakpoint
DROP TABLE `group`;
--> statement-breakpoint
ALTER TABLE `__new_group` RENAME TO `group`;
--> statement-breakpoint
CREATE UNIQUE INDEX `group_owner_name_unique` ON `group` (`owner_id`,`name`);
--> statement-breakpoint
CREATE INDEX `group_owner_idx` ON `group` (`owner_id`);
