CREATE TABLE `drafts` (
	`site_id` text NOT NULL,
	`path` text NOT NULL,
	`collection` text NOT NULL,
	`slug` text NOT NULL,
	`action` text NOT NULL,
	`data` text,
	`content` text,
	`base_sha` text,
	`updated_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`site_id`, `path`),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
