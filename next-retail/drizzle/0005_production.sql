CREATE TABLE `retail_open_bottles` (
	`id` text PRIMARY KEY NOT NULL,
	`lot_id` text NOT NULL,
	`document_id` text NOT NULL,
	`date` text NOT NULL,
	`balance` integer NOT NULL,
	`cost` integer NOT NULL,
	FOREIGN KEY (`lot_id`) REFERENCES `retail_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `retail_documents`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "open_bottle_balance" CHECK("retail_open_bottles"."balance" >= 0),
	CONSTRAINT "open_bottle_cost" CHECK("retail_open_bottles"."cost" >= 0 AND ("retail_open_bottles"."balance" > 0 OR "retail_open_bottles"."cost" = 0))
);
--> statement-breakpoint
CREATE INDEX `retail_open_bottle_lot` ON `retail_open_bottles` (`lot_id`);--> statement-breakpoint
CREATE TABLE `retail_release_products` (
	`aroma` text NOT NULL,
	`volume` integer NOT NULL,
	`product_id` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retail_release_identity` ON `retail_release_products` (`aroma`,`volume`);