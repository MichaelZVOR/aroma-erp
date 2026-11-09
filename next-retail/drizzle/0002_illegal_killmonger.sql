CREATE TABLE `product_profiles` (
	`product_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `retail_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot` text NOT NULL,
	`created` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text NOT NULL,
	`request_key` text,
	`fingerprint` text,
	FOREIGN KEY (`document_id`) REFERENCES `retail_documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retail_history_request_key_unique` ON `retail_history` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `retail_history_version` ON `retail_history` (`document_id`,`revision`);--> statement-breakpoint
ALTER TABLE `retail_documents` ADD `revision` integer DEFAULT 1 NOT NULL;