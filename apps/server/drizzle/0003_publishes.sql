CREATE TABLE `publishes` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text,
	`commit_sha` text NOT NULL,
	`message` text NOT NULL,
	`changes` text NOT NULL,
	`deploy_state` text DEFAULT 'pending' NOT NULL,
	`deploy_checked_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `publishes_site_idx` ON `publishes` (`site_id`,`created_at`);