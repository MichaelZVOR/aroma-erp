CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`capacity` integer,
	`sale` integer,
	`source_id` text,
	`note` text DEFAULT '' NOT NULL,
	CONSTRAINT "product_sale_nonnegative" CHECK("products"."sale" IS NULL OR "products"."sale" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_code_unique` ON `products` (`code`);--> statement-breakpoint
CREATE TABLE `retail_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`shop_id` text NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`created` text NOT NULL,
	`actor` text NOT NULL,
	`note` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`reverses_id` text,
	FOREIGN KEY (`shop_id`) REFERENCES `retail_shops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retail_documents_request_key_unique` ON `retail_documents` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `retail_reversal_once` ON `retail_documents` (`reverses_id`);--> statement-breakpoint
CREATE INDEX `retail_doc_shop_date` ON `retail_documents` (`shop_id`,`date`);--> statement-breakpoint
CREATE TABLE `retail_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`product_id` text NOT NULL,
	`document_id` text NOT NULL,
	`received_date` text NOT NULL,
	`origin_date` text,
	`expiry_date` text,
	`qty` integer NOT NULL,
	`remaining` integer NOT NULL,
	`unit_cost` integer NOT NULL,
	`preliminary` integer NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `retail_shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `retail_documents`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lot_qty_positive" CHECK("retail_lots"."qty" > 0),
	CONSTRAINT "lot_remaining_valid" CHECK("retail_lots"."remaining" >= 0 AND "retail_lots"."remaining" <= "retail_lots"."qty"),
	CONSTRAINT "lot_cost_nonnegative" CHECK("retail_lots"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE INDEX `retail_lot_shop_product` ON `retail_lots` (`shop_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `retail_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`qty` integer NOT NULL,
	`cost` integer NOT NULL,
	`date` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `retail_documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `retail_lots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `retail_movement_lot` ON `retail_movements` (`lot_id`);--> statement-breakpoint
CREATE TABLE `retail_shops` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retail_shops_name_key_unique` ON `retail_shops` (`name_key`);