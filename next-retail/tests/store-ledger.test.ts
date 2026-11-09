import { afterEach, beforeEach, expect, test } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/connect";
import {
  products,
  productProfiles,
  retailDocuments,
  shopLots,
  shopMovements,
} from "../src/db/schema";
import { createStoreLedger } from "../src/server/store-ledger";
import { moneyInput, breakEven, feeMoney } from "../src/domain/money";
import { randomUUID } from "node:crypto";

let connection: ReturnType<typeof openDatabase>;
let ledger: ReturnType<typeof createStoreLedger>;
let first: string, second: string;
const day = "2026-10-01";
beforeEach(() => {
  connection = openDatabase(":memory:");
  migrate(connection.db, { migrationsFolder: "./drizzle" });
  ledger = createStoreLedger(connection);
  [first, second] = ledger.createShops(["Тестовый Север", "Тестовый Юг"]).map((shop) => shop.id);
  connection.db
    .insert(products)
    .values([
      {
        id: "p",
        code: "00001",
        name: "Тестовый готовый распив 5 мл",
        kind: "decant",
        sale: 200000,
      },
      { id: "other", code: "other", name: "Второй товар", kind: "bottle", sale: 10000 },
      { id: "missing", code: "missing", name: "Нет цены", kind: "decant", sale: null },
    ])
    .run();
});
afterEach(() => connection.close());
function receipt(shopId = first, qty = 5, cost = "800", preliminary = false, productId = "p") {
  const document = ledger.receipt(
    {
      key: randomUUID(),
      shopId,
      date: day,
      note: "",
      initial: true,
      rows: [
        { productId, qty, unitCost: cost, preliminary, originDate: "2026-08-01", expiryDate: null },
      ],
    },
    "tester",
  );
  return connection.db.select().from(shopLots).where(eq(shopLots.documentId, document.id)).get()!;
}
function saleInput(lotId: string, qty = 1, shopId = first) {
  return {
    key: randomUUID(),
    shopId,
    date: day,
    note: "",
    rows: [{ lotId, qty, price: "1800", payment: "card" as const, rate: "3" }],
  };
}
function remaining(id: string) {
  return connection.db.select().from(shopLots).where(eq(shopLots.id, id)).get()!.remaining;
}
function totals() {
  return ledger.overview({ month: "2026-10" }).totals;
}

test("catalog alone has no physical stock or invented shops", () => {
  expect(ledger.overview().stockCount).toBe(0);
  expect(() => ledger.createShops(["Другой", "Ещё"])).toThrow("уже созданы");
});
test("stores and purchase batches remain independent", () => {
  const old = receipt(first, 2, "800"),
    fresh = receipt(first, 1, "900"),
    otherStore = receipt(second, 3, "700");
  ledger.sale(saleInput(old.id), "tester");
  expect([remaining(old.id), remaining(fresh.id), remaining(otherStore.id)]).toEqual([1, 1, 3]);
  expect(totals()).toMatchObject({
    revenue: 180000,
    cost: 80000,
    gross: 100000,
    fee: 5400,
    afterFee: 94600,
    margin: "55.56",
    markup: "125",
    discount: 20000,
  });
});
test("cash does not incur fees and preliminary costs remain visible", () => {
  const lot = receipt(first, 2, "800", true);
  const input = saleInput(lot.id);
  input.rows[0] = { ...input.rows[0], payment: "cash" as "card", rate: "" };
  ledger.sale(input, "tester");
  expect(totals()).toMatchObject({
    fee: 0,
    cash: 180000,
    preliminaryCost: 80000,
    preliminaryLines: 1,
  });
});
test("sale retry is idempotent, changed retry is rejected", () => {
  const lot = receipt(),
    input = saleInput(lot.id);
  const firstSave = ledger.sale(input, "tester");
  expect(ledger.sale(input, "tester").id).toBe(firstSave.id);
  expect(remaining(lot.id)).toBe(4);
  expect(() => ledger.sale({ ...input, rows: [{ ...input.rows[0], qty: 2 }] }, "tester")).toThrow(
    "другими данными",
  );
});
test("multi-line failure rolls back all quantities, money and document", () => {
  const lot = receipt(first, 1);
  const input = saleInput(lot.id);
  input.rows.push({ ...input.rows[0] });
  expect(() => ledger.sale(input, "tester")).toThrow("Недостаточно");
  expect(remaining(lot.id)).toBe(1);
  expect(connection.db.select().from(retailDocuments).all()).toHaveLength(1);
  expect(connection.db.select().from(shopMovements).all()).toHaveLength(1);
});
test("cannot consume another shop, future or pre-receipt stock", () => {
  const lot = receipt();
  expect(() => ledger.sale(saleInput(lot.id, 1, second), "tester")).toThrow("не принадлежит");
  expect(() => ledger.sale({ ...saleInput(lot.id), date: "2099-01-01" }, "tester")).toThrow(
    "будущем",
  );
  expect(() => ledger.sale({ ...saleInput(lot.id), date: "2026-09-30" }, "tester")).toThrow(
    "раньше поступления",
  );
});
test("expired stock and missing catalog price are not sold", () => {
  const lot = receipt();
  connection.db
    .update(shopLots)
    .set({ expiryDate: "2026-09-30" })
    .where(eq(shopLots.id, lot.id))
    .run();
  expect(() => ledger.sale(saleInput(lot.id), "tester")).toThrow("истёк");
  const missing = receipt(first, 1, "100", false, "missing");
  expect(() => ledger.sale(saleInput(missing.id), "tester")).toThrow("Нет обычной цены");
});
test("zero-price sale preserves zero, percentages have no zero division", () => {
  const lot = receipt(first, 1, "0");
  const input = saleInput(lot.id);
  input.rows[0].price = "0";
  ledger.sale(input, "tester");
  expect(totals()).toMatchObject({ revenue: 0, cost: 0, fee: 0, margin: null, markup: null });
});
test("count is optimistic and shortage and expense affect month separately", () => {
  const lot = receipt();
  const input = {
    key: randomUUID(),
    shopId: first,
    date: day,
    note: "",
    lotId: lot.id,
    expected: 5,
    actual: 4,
    reason: "Фактический пересчёт",
  };
  ledger.inventory(input, "tester");
  expect(() => ledger.inventory({ ...input, key: randomUUID() }, "tester")).toThrow(
    "Остаток изменился",
  );
  ledger.expense(
    { key: randomUUID(), shopId: first, date: day, note: "", category: "Аренда", amount: "1000" },
    "tester",
  );
  expect(totals()).toMatchObject({ shortage: 80000, expenses: 100000, result: -180000 });
});
test("surplus creates a separate lot with unknown age", () => {
  const lot = receipt(first, 1);
  ledger.inventory(
    {
      key: randomUUID(),
      shopId: first,
      date: day,
      note: "",
      lotId: lot.id,
      expected: 1,
      actual: 3,
      reason: "Пересчёт",
    },
    "tester",
  );
  const lots = connection.db.select().from(shopLots).all();
  expect(lots.reduce((sum, row) => sum + row.remaining, 0)).toBe(3);
  expect(lots.find((row) => row.id !== lot.id)?.originDate).toBeNull();
  expect(totals().surplus).toBe(160000);
});
test("revision atomically restores old stock and records new cost with version history", () => {
  const lot = receipt();
  const input = saleInput(lot.id);
  const original = ledger.sale(input, "tester");
  const revision = {
    ...input,
    key: randomUUID(),
    documentId: original.id,
    revision: 1,
    reason: "Неверное количество",
    rows: [{ ...input.rows[0], qty: 2 }],
  };
  const revised = ledger.revise(revision, "tester");
  expect(revised.revision).toBe(2);
  expect(remaining(lot.id)).toBe(3);
  expect(ledger.revise(revision, "tester").revision).toBe(2);
  expect(ledger.history(original.id)).toHaveLength(2);
  expect(JSON.parse(ledger.history(original.id)[1].snapshot.payload).totals.revenue).toBe(180000);
  expect(totals().revenue).toBe(360000);
  expect(() => ledger.revise({ ...revision, key: randomUUID() }, "tester")).toThrow("уже изменён");
});
test("revision failure restores original quantity, version and snapshots", () => {
  const lot = receipt(first, 1);
  const input = saleInput(lot.id);
  const original = ledger.sale(input, "tester");
  expect(() =>
    ledger.revise(
      {
        ...input,
        key: randomUUID(),
        documentId: original.id,
        revision: 1,
        reason: "Ошибка количества",
        rows: [{ ...input.rows[0], qty: 2 }],
      },
      "tester",
    ),
  ).toThrow("Недостаточно");
  expect(remaining(lot.id)).toBe(0);
  expect(ledger.history(original.id)).toHaveLength(1);
  expect(totals().revenue).toBe(180000);
});
test("cancel revised sale reverses net movements once", () => {
  const lot = receipt();
  const input = saleInput(lot.id);
  const sale = ledger.sale(input, "tester");
  ledger.revise(
    {
      ...input,
      key: randomUUID(),
      documentId: sale.id,
      revision: 1,
      reason: "Количество",
      rows: [{ ...input.rows[0], qty: 2 }],
    },
    "tester",
  );
  const cancel = {
    key: randomUUID(),
    documentId: sale.id,
    reason: "Ошибочный документ",
    date: day,
  };
  const saved = ledger.cancel(cancel, "tester");
  expect(ledger.cancel(cancel, "tester").id).toBe(saved.id);
  expect(remaining(lot.id)).toBe(5);
  expect(totals().revenue).toBe(0);
});
test("dependent movement prevents editing or cancellation", () => {
  const lot = receipt();
  const input = saleInput(lot.id);
  const sale = ledger.sale(input, "tester");
  ledger.sale(saleInput(lot.id), "tester");
  expect(() =>
    ledger.cancel(
      { key: randomUUID(), documentId: sale.id, reason: "Ошибочный", date: day },
      "tester",
    ),
  ).toThrow("движения");
  expect(() =>
    ledger.revise(
      { ...input, key: randomUUID(), documentId: sale.id, revision: 1, reason: "Исправление" },
      "tester",
    ),
  ).toThrow("движения");
  expect(remaining(lot.id)).toBe(3);
});
test("catalog changes never recalculate a saved document or its revision", () => {
  const lot = receipt();
  const input = saleInput(lot.id);
  const sale = ledger.sale(input, "tester");
  connection.db
    .update(products)
    .set({ name: "Новое название", sale: 10000 })
    .where(eq(products.id, "p"))
    .run();
  ledger.revise(
    { ...input, key: randomUUID(), documentId: sale.id, revision: 1, reason: "Только заметка" },
    "tester",
  );
  const doc = ledger.document(sale.id);
  const rows = (doc.payload as { rows: { name: string; listPrice: number }[] }).rows;
  expect(rows[0]).toMatchObject({ name: "Тестовый готовый распив 5 мл", listPrice: 200000 });
});
test("movement totals equal every lot balance and value", () => {
  const lot = receipt();
  ledger.sale(saleInput(lot.id), "tester");
  ledger.inventory(
    {
      key: randomUUID(),
      shopId: first,
      date: day,
      note: "",
      lotId: lot.id,
      expected: 4,
      actual: 2,
      reason: "Пересчёт",
    },
    "tester",
  );
  for (const row of connection.db.select().from(shopLots).all()) {
    const moves = connection.db
      .select()
      .from(shopMovements)
      .where(eq(shopMovements.lotId, row.id))
      .all();
    expect(moves.reduce((sum, move) => sum + move.qty, 0)).toBe(row.remaining);
    expect(moves.reduce((sum, move) => sum + move.cost, 0)).toBe(row.remaining * row.unitCost);
  }
});
test("money input, fee and break-even boundary use exact decimals", () => {
  expect(moneyInput("12,30")).toBe(1230);
  expect(feeMoney(1, "50")).toBe(1);
  expect(breakEven(80000, "3")).toBe(82475);
  expect(() => moneyInput("1.001")).toThrow();
  expect(() => moneyInput("-1")).toThrow();
});
test("search is case insensitive for Cyrillic and treats percent as literal", () => {
  receipt();
  expect(ledger.findProducts("ГОТОВЫЙ")).toHaveLength(1);
  expect(ledger.findProducts("%")).toHaveLength(0);
  expect(ledger.findLots(first, "РАСПИВ")).toHaveLength(1);
});
test("aging retains the origin date of older remaining batches", () => {
  const lot = receipt();
  const stock = ledger.overview({ shopId: first, month: "2026-10", age: 1 }).stocks;
  expect(stock[0]).toMatchObject({ id: lot.id, originDate: "2026-08-01", noSalesThisMonth: true });
  expect(stock[0].ageDays).toBeGreaterThan(60);
  ledger.sale(saleInput(lot.id), "tester");
  expect(ledger.overview({ shopId: first, month: "2026-10" }).stocks[0].noSalesThisMonth).toBe(
    false,
  );
});
test("warehouse journals filter operations before pagination without changing financial totals", () => {
  const lot = receipt();
  ledger.sale(saleInput(lot.id), "tester");
  ledger.expense(
    { key: randomUUID(), shopId: first, date: day, note: "", category: "Аренда", amount: "100" },
    "tester",
  );
  const stock = ledger.overview({
    month: "2026-10",
    documentKinds: ["initial", "receipt", "inventory"],
  });
  expect(stock.documents.map((document) => document.kind)).toEqual(["initial"]);
  expect(stock.documentCount).toBe(1);
  expect(stock.totals).toMatchObject({ revenue: 180000, expenses: 10000 });
  const sales = ledger.overview({
    month: "2026-10",
    documentKinds: ["sale", "reversal", "expense"],
  });
  expect(sales.documentCount).toBe(2);
  expect(sales.documents.every((document) => ["sale", "expense"].includes(document.kind))).toBe(
    true,
  );
});
test("catalogue picker reads categories and suggested cost without creating receipts", () => {
  connection.db
    .insert(productProfiles)
    .values({
      productId: "p",
      data: JSON.stringify({
        category: "Распив",
        purchase_price: 47500,
        barcode: "000012345",
        vendor_code: "P-5",
      }),
    })
    .run();
  const catalogue = ledger.browseProducts("", "Распив");
  expect(catalogue.total).toBe(2);
  expect(catalogue.rows.find(({ product }) => product.id === "p")).toMatchObject({
    suggestedCost: 47500,
    barcode: "000012345",
    vendorCode: "P-5",
  });
  expect(catalogue.categories.find((category) => category.name === "Распив")?.count).toBe(2);
  expect(connection.db.select().from(shopLots).all()).toHaveLength(0);
  expect(connection.db.select().from(retailDocuments).all()).toHaveLength(0);
});
test("catalogue search and category filtering precede pagination", () => {
  for (let index = 0; index < 30; index++) {
    connection.db
      .insert(products)
      .values({
        id: `candle-${index}`,
        code: `candle-${index}`,
        name: `Свеча ${String(index).padStart(2, "0")}`,
        kind: "other",
        sale: null,
      })
      .run();
    connection.db
      .insert(productProfiles)
      .values({
        productId: `candle-${index}`,
        data: JSON.stringify({ category: "Свечи", purchase_price: null }),
      })
      .run();
  }
  expect(ledger.browseProducts("", "Свечи", 1)).toMatchObject({ total: 30, page: 1 });
  expect(ledger.browseProducts("", "Свечи", 2).rows).toHaveLength(5);
  expect(ledger.browseProducts("Свеча 29", "Свечи", 2)).toMatchObject({ total: 1, page: 1 });
  expect(ledger.browseProducts("%", "Свечи").total).toBe(0);
  expect(ledger.browseProducts("", "Свечи").rows[0].suggestedCost).toBeNull();
});
test("journal search and status filter do not change month totals", () => {
  const lot = receipt();
  const sale = ledger.sale({ ...saleInput(lot.id), note: "Нужный отчёт" }, "tester");
  expect(
    ledger
      .overview({ month: "2026-10", q: "НУЖНЫЙ", status: "posted" })
      .documents.map((row) => row.id),
  ).toEqual([sale.id]);
  const filtered = ledger.overview({ month: "2026-10", q: "НУЖНЫЙ", status: "reversed" });
  expect(filtered.documentCount).toBe(0);
  expect(filtered.totals.revenue).toBe(180000);
});

function pricedReceipt(price: string, shopId = first, cost = "900", revision?: number) {
  return ledger.receipt(
    {
      key: randomUUID(),
      shopId,
      date: day,
      note: "",
      initial: false,
      rows: [
        {
          productId: "p",
          qty: 2,
          unitCost: cost,
          salePrice: price,
          priceRevision: revision,
          preliminary: false,
          originDate: null,
          expiryDate: null,
        },
      ],
    },
    "tester",
  );
}
function changePriceInput(
  shopId = first,
  price = "2200",
  expectedRevision = 0,
  expectedPrice: number | null = 200000,
) {
  return {
    key: randomUUID(),
    shopId,
    date: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
    note: "Новый ценник",
    reason: "Новый ценник",
    productId: "p",
    price,
    expectedRevision,
    expectedPrice,
  };
}
test("receipt prices apply to all store lots without changing costs, catalog or another store", () => {
  const old = receipt(first, 5, "800"),
    other = receipt(second, 2, "700");
  const sale = ledger.sale(saleInput(old.id), "tester");
  const snapshot = ledger.document(sale.id);
  pricedReceipt("2300");
  expect(ledger.findLots(first, "").map((row) => row.price)).toEqual([230000, 230000]);
  expect(
    ledger
      .findLots(first, "")
      .map((row) => row.unitCost)
      .sort(),
  ).toEqual([80000, 90000]);
  expect(ledger.findLots(second, "")[0]).toMatchObject({
    id: other.id,
    price: 200000,
    unitCost: 70000,
  });
  expect(connection.db.select().from(products).where(eq(products.id, "p")).get()!.sale).toBe(
    200000,
  );
  expect(ledger.document(sale.id)).toEqual(snapshot);
  expect(ledger.exportStock(first).every((row) => row.product.sale === 230000)).toBe(true);
});
test("manual price changes are atomic, versioned, idempotent and do not move stock", () => {
  const lot = receipt();
  const input = changePriceInput();
  const beforeMovements = connection.db.select().from(shopMovements).all();
  const document = ledger.changePrice(input, "manager");
  expect(ledger.changePrice(input, "manager").id).toBe(document.id);
  expect(ledger.findLots(first, "")[0]).toMatchObject({
    price: 220000,
    unitCost: 80000,
    remaining: lot.remaining,
  });
  expect(connection.db.select().from(shopMovements).all()).toEqual(beforeMovements);
  expect(ledger.priceHistory(first, "p")).toMatchObject([
    { oldPrice: 200000, price: 220000, revision: 1, actor: "manager" },
  ]);
  expect(() =>
    ledger.changePrice({ ...input, key: randomUUID(), price: "2300" }, "manager"),
  ).toThrow("уже изменилась");
  expect(ledger.priceHistory(first, "p")).toHaveLength(1);
  expect(() =>
    ledger.changePrice({ ...changePriceInput(second), key: randomUUID() }, "manager"),
  ).toThrow("отсутствует");
});
test("invalid or stale receipts roll back price changes and all lot movements", () => {
  receipt();
  ledger.changePrice(changePriceInput(), "manager");
  const count = connection.db.select().from(shopLots).all().length;
  expect(() => pricedReceipt("2300", first, "900", 0)).toThrow("изменилась");
  expect(() => pricedReceipt("2300", first, "ошибка", 1)).toThrow();
  expect(connection.db.select().from(shopLots).all()).toHaveLength(count);
  expect(ledger.findLots(first, "")[0].price).toBe(220000);
  expect(ledger.priceHistory(first, "p")).toHaveLength(1);
});
test("store price changes do not alter saved sale prices on revision", () => {
  const lot = receipt();
  const original = ledger.sale(saleInput(lot.id), "tester");
  ledger.changePrice(changePriceInput(first, "1000"), "manager");
  ledger.revise(
    {
      ...saleInput(lot.id),
      key: randomUUID(),
      documentId: original.id,
      revision: 1,
      reason: "Уточнён отчёт",
    },
    "tester",
  );
  expect(ledger.document(original.id).payload).toMatchObject({
    rows: [{ listPrice: 200000, unitCost: 80000, price: 180000 }],
  });
});
test("store prices are used for new sales and stale sale selections are rejected", () => {
  const lot = receipt();
  pricedReceipt("2300");
  const input = saleInput(lot.id);
  expect(() =>
    ledger.sale({ ...input, rows: [{ ...input.rows[0], expectedListPrice: 200000 }] }, "tester"),
  ).toThrow("изменилась");
  const result = ledger.sale(
    {
      ...input,
      key: randomUUID(),
      rows: [{ ...input.rows[0], price: "2300", expectedListPrice: 230000 }],
    },
    "tester",
  );
  expect(ledger.document(result.id).payload).toMatchObject({
    rows: [{ listPrice: 230000, price: 230000, unitCost: 80000 }],
  });
});

test("one perfume can be received in separate lots with different owners", () => {
  const row = {
    productId: "p",
    qty: 2,
    unitCost: "800",
    preliminary: false,
    originDate: null,
    expiryDate: null,
  };
  const saved = ledger.receipt(
    {
      key: randomUUID(),
      shopId: first,
      date: day,
      initial: true,
      rows: [
        { ...row, owner: "Ирина" },
        { ...row, owner: "Миша", qty: 3 },
      ],
    },
    "tester",
  );
  const lots = ledger.overview({ shopId: first }).stocks;
  expect(lots).toHaveLength(2);
  expect(lots).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ productId: "p", owner: "Ирина", remaining: 2 }),
      expect.objectContaining({ productId: "p", owner: "Миша", remaining: 3 }),
    ]),
  );
  expect(ledger.document(saved.id).payload).toMatchObject({
    rows: [{ owner: "Ирина" }, { owner: "Миша" }],
  });
  expect(receipt(second).owner).toBeNull();
});

test("transfer keeps a lot's cost, owner and dates and appears at both shops", () => {
  const purchase = ledger.receipt(
    {
      key: randomUUID(),
      shopId: first,
      date: day,
      initial: true,
      rows: [
        {
          productId: "p",
          qty: 4,
          unitCost: "650.25",
          preliminary: true,
          originDate: "2026-08-01",
          expiryDate: "2026-12-01",
          owner: "Ирина",
        },
      ],
    },
    "tester",
  );
  const original = connection.db
    .select()
    .from(shopLots)
    .where(eq(shopLots.documentId, purchase.id))
    .get()!;
  const input = {
    kind: "transfer",
    key: randomUUID(),
    shopId: first,
    destinationShopId: second,
    date: "2026-10-02",
    rows: [{ lotId: original.id, qty: 2 }],
  };
  const doc = ledger.dispatchStock(input, "tester");
  expect(ledger.dispatchStock(input, "tester").id).toBe(doc.id);
  expect(remaining(original.id)).toBe(2);
  expect(
    connection.db.select().from(shopLots).where(eq(shopLots.documentId, doc.id)).all(),
  ).toMatchObject([
    {
      shopId: second,
      qty: 2,
      remaining: 2,
      unitCost: 65025,
      owner: "Ирина",
      preliminary: true,
      originDate: "2026-08-01",
      expiryDate: "2026-12-01",
      receivedDate: "2026-10-02",
    },
  ]);
  expect(
    connection.db
      .select()
      .from(shopMovements)
      .where(eq(shopMovements.documentId, doc.id))
      .all()
      .map(({ qty, cost }) => [qty, cost]),
  ).toEqual([
    [-2, -130050],
    [2, 130050],
  ]);
  for (const shopId of [first, second]) {
    expect(
      ledger
        .overview({ shopId, month: "2026-10", documentKinds: ["transfer"] })
        .documents.map(({ id }) => id),
    ).toEqual([doc.id]);
  }
});

test("write-off records the reason and rolls back all rows if a party is insufficient", () => {
  const one = receipt(first, 2);
  const two = receipt(first, 1);
  const input = {
    kind: "writeoff",
    key: randomUUID(),
    shopId: first,
    date: day,
    reason: "Тестер",
    rows: [
      { lotId: one.id, qty: 1 },
      { lotId: two.id, qty: 2 },
    ],
  };
  expect(() => ledger.dispatchStock(input, "tester")).toThrow("Недостаточно");
  expect([remaining(one.id), remaining(two.id)]).toEqual([2, 1]);
  expect(ledger.overview({ month: "2026-10", documentKinds: ["writeoff"] }).documentCount).toBe(0);
  const doc = ledger.dispatchStock({ ...input, rows: [{ lotId: one.id, qty: 1 }] }, "tester");
  expect(remaining(one.id)).toBe(1);
  expect(JSON.parse(doc.payload)).toMatchObject({ reason: "Тестер", cost: 80000 });
  expect(ledger.overview({ month: "2026-10", documentKinds: ["writeoff"] }).documentCount).toBe(1);
});
