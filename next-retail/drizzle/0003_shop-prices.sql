CREATE TABLE `retail_price_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shop_id` text NOT NULL,
	`product_id` text NOT NULL,
	`document_id` text NOT NULL,
	`old_price` integer,
	`price` integer NOT NULL,
	`revision` integer NOT NULL,
	`created` text NOT NULL,
	`actor` text NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `retail_shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `retail_documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retail_price_history_version` ON `retail_price_history` (`shop_id`,`product_id`,`revision`);--> statement-breakpoint
CREATE TABLE `retail_prices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shop_id` text NOT NULL,
	`product_id` text NOT NULL,
	`price` integer NOT NULL,
	`revision` integer NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `retail_shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "retail_price_nonnegative" CHECK("retail_prices"."price" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retail_price_shop_product` ON `retail_prices` (`shop_id`,`product_id`);