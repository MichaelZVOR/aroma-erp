import { check, integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { stockOwners } from "../domain/stock-owners";

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey().notNull(),
  value: text("value").notNull(),
});

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    capacity: integer("capacity"),
    sale: integer("sale"),
    sourceId: text("source_id"),
    note: text("note").notNull().default(""),
  },
  (table) => [check("product_sale_nonnegative", sql`${table.sale} IS NULL OR ${table.sale} >= 0`)],
);

export const shops = sqliteTable("retail_shops", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull().unique(),
  created: text("created").notNull(),
});
export const retailDocuments = sqliteTable(
  "retail_documents",
  {
    id: text("id").primaryKey(),
    requestKey: text("request_key").notNull().unique(),
    fingerprint: text("fingerprint").notNull(),
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id),
    kind: text("kind").notNull(),
    date: text("date").notNull(),
    created: text("created").notNull(),
    actor: text("actor").notNull(),
    note: text("note").notNull(),
    payload: text("payload").notNull(),
    status: text("status").notNull().default("posted"),
    reversesId: text("reverses_id"),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    uniqueIndex("retail_reversal_once").on(table.reversesId),
    index("retail_doc_shop_date").on(table.shopId, table.date),
  ],
);
export const shopLots = sqliteTable(
  "retail_lots",
  {
    id: text("id").primaryKey(),
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    documentId: text("document_id")
      .notNull()
      .references(() => retailDocuments.id),
    receivedDate: text("received_date").notNull(),
    originDate: text("origin_date"),
    owner: text("owner", { enum: stockOwners }),
    expiryDate: text("expiry_date"),
    qty: integer("qty").notNull(),
    remaining: integer("remaining").notNull(),
    unitCost: integer("unit_cost").notNull(),
    preliminary: integer("preliminary", { mode: "boolean" }).notNull(),
  },
  (table) => [
    check("lot_qty_positive", sql`${table.qty} > 0`),
    check(
      "lot_remaining_valid",
      sql`${table.remaining} >= 0 AND ${table.remaining} <= ${table.qty}`,
    ),
    check("lot_cost_nonnegative", sql`${table.unitCost} >= 0`),
    index("retail_lot_shop_product").on(table.shopId, table.productId),
  ],
);
export const shopMovements = sqliteTable(
  "retail_movements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    documentId: text("document_id")
      .notNull()
      .references(() => retailDocuments.id),
    lotId: text("lot_id")
      .notNull()
      .references(() => shopLots.id),
    qty: integer("qty").notNull(),
    cost: integer("cost").notNull(),
    date: text("date").notNull(),
  },
  (table) => [index("retail_movement_lot").on(table.lotId)],
);

export const retailHistory = sqliteTable(
  "retail_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    documentId: text("document_id")
      .notNull()
      .references(() => retailDocuments.id),
    revision: integer("revision").notNull(),
    snapshot: text("snapshot").notNull(),
    created: text("created").notNull(),
    actor: text("actor").notNull(),
    reason: text("reason").notNull(),
    requestKey: text("request_key").unique(),
    fingerprint: text("fingerprint"),
  },
  (table) => [uniqueIndex("retail_history_version").on(table.documentId, table.revision)],
);

export const productProfiles = sqliteTable("product_profiles", {
  productId: text("product_id")
    .primaryKey()
    .references(() => products.id),
  revision: integer("revision").notNull().default(1),
  data: text("data").notNull(),
});

export const shopPrices = sqliteTable(
  "retail_prices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    price: integer("price").notNull(),
    revision: integer("revision").notNull(),
  },
  (table) => [
    uniqueIndex("retail_price_shop_product").on(table.shopId, table.productId),
    check("retail_price_nonnegative", sql`${table.price} >= 0`),
  ],
);
export const shopPriceHistory = sqliteTable(
  "retail_price_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    documentId: text("document_id")
      .notNull()
      .references(() => retailDocuments.id),
    oldPrice: integer("old_price"),
    price: integer("price").notNull(),
    revision: integer("revision").notNull(),
    created: text("created").notNull(),
    actor: text("actor").notNull(),
  },
  (table) => [
    uniqueIndex("retail_price_history_version").on(table.shopId, table.productId, table.revision),
  ],
);

export const openedBottles = sqliteTable(
  "retail_open_bottles",
  {
    id: text("id").primaryKey(),
    lotId: text("lot_id")
      .notNull()
      .references(() => shopLots.id),
    documentId: text("document_id")
      .notNull()
      .references(() => retailDocuments.id),
    date: text("date").notNull(),
    balance: integer("balance").notNull(),
    cost: integer("cost").notNull(),
  },
  (table) => [
    check("open_bottle_balance", sql`${table.balance} >= 0`),
    check(
      "open_bottle_cost",
      sql`${table.cost} >= 0 AND (${table.balance} > 0 OR ${table.cost} = 0)`,
    ),
    index("retail_open_bottle_lot").on(table.lotId),
  ],
);

export const releaseProducts = sqliteTable(
  "retail_release_products",
  {
    aroma: text("aroma").notNull(),
    volume: integer("volume").notNull(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
  },
  (table) => [uniqueIndex("retail_release_identity").on(table.aroma, table.volume)],
);
