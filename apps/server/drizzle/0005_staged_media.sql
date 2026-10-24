CREATE TABLE `staged_media` (
	`site_id` text NOT NULL,
	`path` text NOT NULL,
	`bytes` blob NOT NULL,
	`size` integer NOT NULL,
	`kind` text NOT NULL,
	`width` integer,
	`height` integer,
	`uploaded_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`site_id`, `path`),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
