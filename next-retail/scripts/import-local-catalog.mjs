import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { mkdirSync } from "node:fs";
const sourcePath = path.resolve(process.argv[2] ?? "data/legacy-snapshot.sqlite3");
const targetPath = path.resolve("data/retail.sqlite3");
if (sourcePath === targetPath) throw new Error("Источник и назначение совпадают");
mkdirSync(path.dirname(targetPath), { recursive: true });
const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
const target = new Database(targetPath);
try {
  target.pragma("foreign_keys = ON");
  migrate(drizzle(target), { migrationsFolder: "./drizzle" });
  if (source.pragma("integrity_check", { simple: true }) !== "ok")
    throw new Error("Источник не прошёл проверку целостности");
  const items = source
    .prepare(
      "SELECT p.* FROM products p WHERE p.kind != 'liquid' AND EXISTS (SELECT 1 FROM catalog_members c WHERE c.product_id = p.id)",
    )
    .all();
  const insert = target.prepare(
    "INSERT INTO products(id,code,name,kind,capacity,sale,source_id,note) VALUES(@id,@code,@name,@kind,@capacity,@sale,@source_id,@note) ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,kind=excluded.kind,capacity=excluded.capacity,sale=excluded.sale,source_id=excluded.source_id,note=excluded.note",
  );
  const profile = source.prepare("SELECT * FROM product_profiles WHERE product_id = ?");
  const saveProfile = target.prepare(
    "INSERT INTO product_profiles(product_id,revision,data) VALUES(@product_id,@revision,@data) ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,data=excluded.data",
  );
  target
    .transaction(() => {
      for (const item of items) {
        insert.run(item);
        const details = profile.get(item.id);
        if (details) saveProfile.run(details);
      }
    })
    .immediate();
  console.log(`Перенесено карточек: ${items.length}. Остатки и продажи не создавались.`);
} finally {
  target.close();
  source.close();
}
