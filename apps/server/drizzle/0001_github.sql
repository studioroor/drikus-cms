CREATE TABLE `git_blobs` (
	`sha` text PRIMARY KEY NOT NULL,
	`content` blob NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `git_trees` (
	`sha` text PRIMARY KEY NOT NULL,
	`entries` text NOT NULL,
	`truncated` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `sites` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `sites` ADD `head_tree_sha` text;--> statement-breakpoint
ALTER TABLE `sites` ADD `head_checked_at` integer;