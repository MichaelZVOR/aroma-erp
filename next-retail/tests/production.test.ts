import { afterEach, beforeEach, expect, test } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/connect";
import { openedBottles, products, shopLots } from "../src/db/schema";
import { todayMoscow } from "../src/domain/store-sales";
import { createStoreLedger } from "../src/server/store-ledger";

let db: ReturnType<typeof openDatabase>;
let ledger: ReturnType<typeof createStoreLedger>;
let shopId: string, otherShop: string, bottle: string, atom: string, label: string;

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db.db, { migrationsFolder: "./drizzle" });
  ledger = createStoreLedger(db);
  [shopId, otherShop] = ledger.createShops(["Первый", "Второй"]).map((shop) => shop.id);
  db.db
    .insert(products)
    .values({
      id: "perfume",
      code: "P",
      name: "Дом - Аромат (edp) - 35 мл",
      kind: "bottle",
      capacity: 35000,
    })
    .run();
  const atomId = ledger.createMaterial({ kind: "atom", name: "Флакон 10 мл", capacity: 10 });
  const labelId = ledger.createMaterial({ kind: "label", name: "Наклейка" });
  bottle = receipt("perfume", 1, "1000", "Ирина");
  atom = receipt(atomId, 10, "30");
  label = receipt(labelId, 10, "5");
});
afterEach(() => db.close());

function receipt(productId: string, qty: number, unitCost: string, owner?: "Ирина", shop = shopId) {
  const doc = ledger.receipt(
    {
      key: randomUUID(),
      shopId: shop,
      date: todayMoscow(),
      initial: false,
      rows: [
        { productId, qty, unitCost, owner, originDate: null, expiryDate: null, preliminary: false },
      ],
    },
    "tester",
  );
  return db.db.select().from(shopLots).where(eq(shopLots.documentId, doc.id)).get()!.id;
}
function draft(source = bottle) {
  return {
    shopId,
    source,
    atom,
    label,
    volume: 10,
    quantity: 2,
    work: "8",
    workMode: "ml",
    extra: "1",
    outputName: "",
  };
}
function prepare(input = draft()) {
  const quote = ledger.quoteProduction(input);
  return { ...input, key: randomUUID(), fingerprint: quote.fingerprint, date: quote.date };
}
function stock(id: string) {
  return db.db.select().from(shopLots).where(eq(shopLots.id, id)).get()!;
}
function outputLots(id: string) {
  return db.db.select().from(shopLots).where(eq(shopLots.documentId, id)).all();
}

test("release consumes materials in the source store and makes output sellable at the destination", () => {
  db.db
    .insert(products)
    .values({
      id: "destination-output",
      code: "D",
      name: "Дом — Аромат (edp) — 10 мл",
      kind: "decant",
      capacity: 10000,
      sale: 60000,
    })
    .run();
  const input = { ...draft(), destinationShopId: otherShop };
  const request = prepare(input);
  expect(() => ledger.release({ ...request, destinationShopId: shopId }, "tester")).toThrow(
    "устарел",
  );
  expect(() => ledger.quoteProduction({ ...input, destinationShopId: "missing" })).toThrow(
    "магазин",
  );
  expect(stock(bottle).remaining).toBe(1);
  const doc = ledger.release(request, "tester");
  expect(doc.shopId).toBe(shopId);
  expect(JSON.parse(doc.payload)).toMatchObject({ destinationShopId: otherShop });
  expect([stock(bottle).remaining, stock(atom).remaining, stock(label).remaining]).toEqual([
    0, 8, 8,
  ]);
  expect(ledger.productionOptions(shopId).opened[0].open.balance).toBe(15000);
  expect(ledger.productionOptions(otherShop).opened).toEqual([]);
  expect(
    ledger.findLots(shopId, "10 мл").filter((row) => row.productId === "destination-output"),
  ).toEqual([]);
  const [lot] = outputLots(doc.id);
  expect(lot).toMatchObject({ shopId: otherShop, owner: "Ирина", unitCost: 40171 });
  const sale = ledger.sale(
    {
      key: randomUUID(),
      shopId: otherShop,
      date: todayMoscow(),
      rows: [{ lotId: lot.id, qty: 1, price: "600", payment: "cash", rate: "0" }],
    },
    "tester",
  );
  expect(JSON.parse(sale.payload).totals.cost).toBe(lot.unitCost);
  expect(ledger.release(request, "tester").id).toBe(doc.id);
});

test("first release opens one bottle and conserves the full cost down to the last cent", () => {
  const input = prepare();
  expect(stock(bottle).remaining).toBe(1);
  const first = ledger.release(input, "tester");
  const output = outputLots(first.id);
  expect(output.map((lot) => [lot.qty, lot.unitCost, lot.owner])).toEqual([
    [1, 40171, "Ирина"],
    [1, 40172, "Ирина"],
  ]);
  expect([stock(bottle).remaining, stock(atom).remaining, stock(label).remaining]).toEqual([
    0, 8, 8,
  ]);
  expect(ledger.release(input, "tester").id).toBe(first.id);
  expect(ledger.overview({ documentKinds: ["production"] }).documentCount).toBe(1);
  const { open } = ledger.productionOptions(shopId).opened[0];
  expect(open).toMatchObject({ balance: 15000, cost: 42857 });
  const second = ledger.release(
    prepare({ ...draft(`open:${open.id}`), volume: 5, quantity: 3 }),
    "tester",
  );
  expect(ledger.productionOptions(shopId).opened).toEqual([]);
  expect(db.db.select().from(openedBottles).get()).toMatchObject({ balance: 0, cost: 0 });
  expect(JSON.parse(first.payload).perfumeCost + JSON.parse(second.payload).perfumeCost).toBe(
    100000,
  );
  expect(
    ledger
      .findLots(shopId, "Аромат (edp) — 10 мл")
      .map((lot) => lot.id)
      .sort(),
  ).toEqual(output.map((lot) => lot.id).sort());
});

test("an existing catalog card is reused and the finished stock can be sold", () => {
  db.db
    .insert(products)
    .values({
      id: "existing",
      code: "E",
      name: "Дом — Аромат (edp) — 10 мл",
      kind: "decant",
      capacity: 10000,
      sale: 60000,
    })
    .run();
  const first = ledger.release(prepare(), "tester");
  const { open } = ledger.productionOptions(shopId).opened[0];
  const second = ledger.release(prepare({ ...draft(`open:${open.id}`), quantity: 1 }), "tester");
  expect(outputLots(first.id)[0].productId).toBe("existing");
  const [lot] = outputLots(second.id);
  expect(lot.productId).toBe("existing");
  const sale = ledger.sale(
    {
      key: randomUUID(),
      shopId,
      date: todayMoscow(),
      rows: [{ lotId: lot.id, qty: 1, price: "600", payment: "cash", rate: "0" }],
    },
    "tester",
  );
  expect(JSON.parse(sale.payload).totals.cost).toBe(lot.unitCost);
  expect(stock(lot.id).remaining).toBe(0);
});

test("rejects a stale quote and refuses components from another shop or too small", () => {
  const stale = prepare();
  ledger.release(prepare({ ...draft(), quantity: 1 }), "tester");
  expect(() => ledger.release(stale, "tester")).toThrow();
  expect(ledger.overview({ documentKinds: ["production"] }).documentCount).toBe(1);
  const { open } = ledger.productionOptions(shopId).opened[0];
  const local = draft(`open:${open.id}`);
  const small = ledger.createMaterial({ kind: "atom", name: "Флакон 3 мл", capacity: 3 });
  expect(() => ledger.quoteProduction({ ...local, atom: receipt(small, 2, "1") })).toThrow(
    "меньше",
  );
  const foreign = receipt(stock(label).productId, 2, "1", undefined, otherShop);
  expect(() => ledger.quoteProduction({ ...local, label: foreign })).toThrow("магазину");
  expect(stock(label).remaining).toBe(9);
});
