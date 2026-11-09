import "server-only";
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../db/connect";
import { createStoreLedger } from "./store-ledger";

let connection: ReturnType<typeof openDatabase> | undefined;
let ledger: ReturnType<typeof createStoreLedger> | undefined;
export function getStoreLedger() {
  if (!ledger) {
    const directory = path.join(process.cwd(), "data");
    mkdirSync(directory, { recursive: true });
    connection = openDatabase(path.join(directory, "retail.sqlite3"));
    migrate(connection.db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    ledger = createStoreLedger(connection);
  }
  return ledger;
}

type CatalogueCard = {
  id: string;
  code: string;
  name: string;
  kind: string;
  capacity: number | null;
  sale: number | null;
  source_id: string | null;
  note: string;
  revision: number;
  data: string;
};

export function refreshReceiptCatalogue() {
  getStoreLedger();
  const sourceFile = path.resolve(process.cwd(), "..", "data", "aroma.sqlite3");
  if (!existsSync(sourceFile) || !connection) return;
  const source = new Database(sourceFile, { readonly: true, fileMustExist: true });
  const target = connection.sqlite;
  try {
    const cards = source
      .prepare<[], CatalogueCard>(
        `
      SELECT p.*, d.revision, d.data
      FROM products p JOIN product_profiles d ON p.id = d.product_id
      WHERE p.kind != 'liquid'
    `,
      )
      .all();
    const find = target.prepare<[string], { id: string; code: string; kind: string }>(
      "SELECT id, code, kind FROM products WHERE id = ?",
    );
    const insert = target.prepare<CatalogueCard>(`
      INSERT INTO products(id, code, name, kind, capacity, sale, source_id, note)
      VALUES(@id, @code, @name, @kind, @capacity, @sale, @source_id, @note)
      ON CONFLICT DO NOTHING
    `);
    const updateProfile = target.prepare<CatalogueCard>(`
      INSERT INTO product_profiles(product_id, revision, data) VALUES(@id, @revision, @data)
      ON CONFLICT(product_id) DO UPDATE SET revision = excluded.revision, data = excluded.data
      WHERE product_profiles.data IS NOT excluded.data OR product_profiles.revision != excluded.revision
    `);
    const updateCataloguePrice = target.prepare<CatalogueCard>(
      "UPDATE products SET sale = @sale WHERE id = @id AND @sale IS NOT NULL AND sale IS NOT @sale",
    );
    target
      .transaction(() => {
        for (const card of cards) {
          if (!find.get(card.id)) {
            if (JSON.parse(card.data).archived_from_catalog) continue;
            insert.run(card);
          }
          const existing = find.get(card.id);
          if (existing?.code === card.code && existing.kind === card.kind) {
            updateProfile.run(card);
            updateCataloguePrice.run(card);
          }
        }
      })
      .immediate();
  } finally {
    source.close();
  }
}
