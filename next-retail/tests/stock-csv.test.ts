import { expect, test } from "vitest";
import {
  bifitCatalogCsv,
  fillStockTemplate,
  readCsv,
  stockReportCsv,
  writeCsv,
} from "../src/domain/stock-csv";
import type { StoreLedger } from "../src/server/store-ledger";
type ExportRows = ReturnType<StoreLedger["exportStock"]>;
const rows: ExportRows = [
  {
    lot: {
      id: "lot-1",
      shopId: "shop",
      productId: "p",
      documentId: "receipt",
      receivedDate: "2026-10-01",
      originDate: null,
      owner: null,
      expiryDate: null,
      qty: 3,
      remaining: 0,
      unitCost: 12345,
      preliminary: true,
    },
    product: {
      id: "p",
      code: "000012",
      name: 'Аромат; "Цитрус"\n5 мл',
      kind: "decant",
      capacity: 5000,
      sale: 30000,
      sourceId: null,
      note: "",
    },
    shop: {
      id: "shop",
      name: "Тестовый магазин",
      nameKey: "тестовый магазин",
      created: "2026-10-01T00:00:00Z",
    },
    profile: JSON.stringify({
      bifit_id: "00123",
      raw_bifit: {
        ID: "00123",
        EXTERNAL_CODE: "000012",
        NAME: "Старое имя",
        NDS: "6",
        GTIN: "00701666410454",
        PURCHASE_PRICE: "123.45",
      },
    }),
  },
];
test("CSV round trip preserves Cyrillic, quotes, semicolons, newlines and leading zero codes", () => {
  const parsed = readCsv(stockReportCsv(rows));
  expect(parsed[1][1]).toBe("000012");
  expect(parsed[1][2]).toBe(rows[0].product.name);
  expect(parsed[1][8]).toBe("123.45");
  expect(parsed[1][7]).toBe("0");
});
test("BIFIT catalog preserves fiscal metadata and does not invent quantity columns", () => {
  const present = { ...rows[0], lot: { ...rows[0].lot, remaining: 2 } };
  const [headers, record] = readCsv(bifitCatalogCsv([present, present]));
  expect(record[headers.indexOf("ID")]).toBe("00123");
  expect(record[headers.indexOf("NAME")]).toBe(rows[0].product.name);
  expect(record[headers.indexOf("NDS")]).toBe("6");
  expect(record[headers.indexOf("GTIN")]).toBe("00701666410454");
  expect(headers).not.toContain("QUANTITY");
  expect(readCsv(bifitCatalogCsv([present, present]))).toHaveLength(2);
});
test("stock template changes only tracked quantities, including sold-out zero stock", () => {
  const source = writeCsv([
    ["ID", "Название", "Количество", "Цена"],
    ["00123", "Товар", "100", "777"],
    ["different", "Не учтён", "2", "3"],
  ]);
  const result = readCsv(fillStockTemplate(rows, source, "ID", "Количество", "bifit", ";"));
  expect(result[1]).toEqual(["00123", "Товар", "0", "777"]);
  expect(result[2]).toEqual(["different", "Не учтён", "2", "3"]);
});
test("template cannot silently drop tracked goods, duplicate identifiers or use the wrong column", () => {
  expect(() => fillStockTemplate(rows, "ID;Q\nother;2\n", "ID", "Q", "bifit", ";")).toThrow(
    "не содержит",
  );
  expect(() =>
    fillStockTemplate(rows, "ID;Q\n00123;2\n00123;3\n", "ID", "Q", "bifit", ";"),
  ).toThrow("повторяется");
  expect(() => fillStockTemplate(rows, "ID;Q\n00123;2\n", "ID", "ID", "bifit", ";")).toThrow(
    "разные",
  );
});
test("multiple batches aggregate by stable code for template export", () => {
  const stock = [
    { ...rows[0], lot: { ...rows[0].lot, remaining: 2 } },
    { ...rows[0], lot: { ...rows[0].lot, id: "lot-2", remaining: 3 } },
  ];
  const result = readCsv(
    fillStockTemplate(stock, "Код,Остаток\n000012,0\n", "Код", "Остаток", "code", ","),
    ",",
  );
  expect(result[1]).toEqual(["000012", "5"]);
});

test("BIFIT assortment excludes sold-out goods and retains extra imported fields", () => {
  const metadata = JSON.parse(rows[0].profile!);
  metadata.raw_bifit.MARK_TYPE = "PERFUMES";
  metadata.raw_bifit["Дополнение|123"] = "значение";
  const present = {
    ...rows[0],
    product: { ...rows[0].product, sale: 55000 },
    lot: { ...rows[0].lot, remaining: 2 },
    profile: JSON.stringify(metadata),
  };
  const [headers, record] = readCsv(bifitCatalogCsv([rows[0], present]));
  expect(record[headers.indexOf("PRICE")]).toBe("550");
  expect(record[headers.indexOf("MARK_TYPE")]).toBe("PERFUMES");
  expect(record[headers.indexOf("Дополнение|123")]).toBe("значение");
  expect(readCsv(bifitCatalogCsv(rows))).toHaveLength(1);
  expect(() =>
    bifitCatalogCsv([present, { ...present, shop: { ...present.shop, id: "other-shop" } }]),
  ).toThrow("один магазин");
});
