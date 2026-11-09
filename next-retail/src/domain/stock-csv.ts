import { rubles, multiplyMoney } from "./money";
import type { StoreLedger } from "../server/store-ledger";
type StockRow = ReturnType<StoreLedger["exportStock"]>[number];
export function writeCsv(rows: string[][], separator = ";") {
  return (
    "\uFEFF" +
    rows
      .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(separator))
      .join("\r\n") +
    "\r\n"
  );
}
export function readCsv(text: string, separator = ";") {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = !quoted;
    } else if (char === separator && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\r" || char === "\n") && !quoted) {
      if (char === "\r" && input[index + 1] === "\n") index++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("В шаблоне не закрыты кавычки");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length || rows.some((entry) => entry.length !== rows[0].length))
    throw new Error("Неодинаковое количество колонок CSV");
  if (new Set(rows[0]).size !== rows[0].length) throw new Error("Названия колонок CSV повторяются");
  return rows;
}
export function stockReportCsv(stock: StockRow[]) {
  return writeCsv([
    [
      "Магазин",
      "Код",
      "Название",
      "Партия",
      "Поступление",
      "Исходная дата",
      "Годен до",
      "Остаток, шт.",
      "Себестоимость, руб.",
      "Стоимость остатка, руб.",
      "Цена продажи, руб.",
      "Предварительная стоимость",
    ],
    ...stock.map(({ lot, product, shop }) => [
      shop.name,
      product.code,
      product.name,
      lot.id,
      lot.receivedDate,
      lot.originDate ?? "",
      lot.expiryDate ?? "",
      String(lot.remaining),
      rubles(lot.unitCost),
      rubles(multiplyMoney(lot.unitCost, lot.remaining)),
      product.sale === null ? "" : rubles(product.sale),
      lot.preliminary ? "Да" : "Нет",
    ]),
  ]);
}
const bifitColumns =
  "ID;EXTERNAL_CODE;EXTERNAL_ID;NAME;FEATURES;PRICE;BARCODE;VENDOR_CODE;NDS;PAYMENT_SUBJECT;GROUP;UNIT_CODE;PURCHASE_PRICE;WEIGHTED;ALCOHOL;GTIN;MARK_TYPE;GROUPED;CONTAINER;MODIFIERS;INGREDIENTS;GOOD_TYPE;CONTRACTOR_INN;CONTRACTOR_ACTIVITY_TYPE;COUNTY_CODE;CUSTOM_DECLARATION;PLU_CODE;ORG_MEMBER_POINTS".split(
    ";",
  );
export function bifitCatalogCsv(stock: StockRow[]) {
  if (new Set(stock.map((row) => row.shop.id)).size > 1)
    throw new Error("Для БИФИТ выберите один магазин");
  const seen = new Set<string>();
  const records: Record<string, string>[] = [];
  const columns = new Set(bifitColumns);
  for (const { product, profile, lot } of stock) {
    if (lot.remaining <= 0 || seen.has(product.id)) continue;
    seen.add(product.id);
    const raw = profile
      ? (JSON.parse(profile) as { raw_bifit?: Record<string, string> }).raw_bifit
      : null;
    if (!raw) throw new Error(`Для товара отсутствуют исходные реквизиты БИФИТ: ${product.name}`);
    if (product.sale === null) throw new Error(`Не задана цена продажи магазина: ${product.name}`);
    for (const key of Object.keys(raw)) columns.add(key);
    records.push({ ...raw, NAME: product.name, PRICE: rubles(product.sale) });
  }
  const headers = [...columns];
  return writeCsv([
    headers,
    ...records.map((record) => headers.map((column) => record[column] ?? "")),
  ]);
}

export function fillStockTemplate(
  stock: StockRow[],
  text: string,
  identifierColumn: string,
  quantityColumn: string,
  identifierType: string,
  separator: string,
) {
  if (![";", ",", "\t"].includes(separator)) throw new Error("Неверный разделитель");
  if (!["bifit", "code"].includes(identifierType)) throw new Error("Выберите тип идентификатора");
  const rows = readCsv(text, separator);
  const idIndex = rows[0].indexOf(identifierColumn),
    qtyIndex = rows[0].indexOf(quantityColumn);
  if (idIndex < 0 || qtyIndex < 0 || idIndex === qtyIndex)
    throw new Error("Укажите разные существующие колонки кода и количества");
  const totals = new Map<string, number>();
  for (const { lot, product, profile } of stock) {
    const metadata = profile ? (JSON.parse(profile) as { bifit_id?: string }) : null;
    const identifier = identifierType === "code" ? product.code : metadata?.bifit_id;
    if (!identifier) throw new Error(`Нет идентификатора БИФИТ у ${product.name}`);
    totals.set(identifier, (totals.get(identifier) ?? 0) + lot.remaining);
  }
  const matched = new Set<string>();
  for (const row of rows.slice(1)) {
    const identifier = row[idIndex];
    if (!totals.has(identifier)) continue;
    if (matched.has(identifier)) throw new Error("В шаблоне повторяется код товара");
    row[qtyIndex] = String(totals.get(identifier));
    matched.add(identifier);
  }
  if (matched.size !== totals.size)
    throw new Error(
      `Шаблон не содержит ${totals.size - matched.size} учтённых товаров. Выгрузите полный отчёт остатков выбранного магазина из БИФИТ`,
    );
  return writeCsv(rows, separator);
}
