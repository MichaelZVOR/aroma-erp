import { z } from "zod";
import { stockOwners } from "./stock-owners";
import { feeMoney, multiplyMoney, percent, subtractMoney, sumMoney } from "./money";

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }, "Некорректная дата");

const id = z.string().min(1).max(100);
const note = z.string().trim().max(1000).default("");
const quantity = z.number().int().min(1).max(100000);
const money = z.string().min(1).max(30);
const common = { key: id, shopId: id, date: dateSchema, note };

export const receiptSchema = z.object({
  ...common,
  initial: z.boolean(),
  rows: z
    .array(
      z.object({
        productId: id,
        qty: quantity,
        unitCost: money,
        salePrice: money.optional(),
        priceRevision: z.number().int().nonnegative().optional(),
        preliminary: z.boolean(),
        owner: z.enum(stockOwners).nullable().optional(),
        originDate: dateSchema.nullable(),
        expiryDate: dateSchema.nullable(),
      }),
    )
    .min(1)
    .max(200),
});
export const saleSchema = z.object({
  ...common,
  rows: z
    .array(
      z.object({
        lotId: id,
        qty: quantity,
        price: money,
        expectedListPrice: z.number().int().nonnegative().nullable().optional(),
        payment: z.enum(["cash", "card"]),
        rate: z.string().max(30),
      }),
    )
    .min(1)
    .max(200),
});
export const countSchema = z.object({
  ...common,
  lotId: id,
  expected: z.number().int().nonnegative(),
  actual: z.number().int().min(0).max(100000),
  reason: z.string().trim().min(3).max(1000),
});
export const expenseSchema = z.object({
  ...common,
  category: z.string().trim().min(1).max(100),
  amount: money,
});
const dispatchRows = z
  .array(z.object({ lotId: id, qty: quantity }))
  .min(1)
  .max(200);
export const stockDispatchSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("transfer"), destinationShopId: id, rows: dispatchRows }),
  z.object({
    ...common,
    kind: z.literal("writeoff"),
    reason: note.refine((value) => value.length >= 3, "Укажите причину списания"),
    rows: dispatchRows,
  }),
]);

export const cancelSchema = z.object({
  key: id,
  documentId: id,
  reason: z.string().trim().min(3).max(1000),
  date: dateSchema,
});
export const reviseSchema = saleSchema.extend({
  documentId: id,
  revision: z.number().int().positive(),
  reason: z.string().trim().min(3).max(1000),
});
export type ReceiptInput = z.infer<typeof receiptSchema>;
export type SaleInput = z.infer<typeof saleSchema>;
export type CountInput = z.infer<typeof countSchema>;
export type ExpenseInput = z.infer<typeof expenseSchema>;
export type CancelInput = z.infer<typeof cancelSchema>;

export type SaleLine = {
  lotId: string;
  productId: string;
  name: string;
  code: string;
  qty: number;
  unitCost: number;
  listPrice: number;
  price: number;
  preliminary: boolean;
  payment: "cash" | "card";
  rate: string;
};
export function calculateLine(row: SaleLine) {
  const revenue = multiplyMoney(row.price, row.qty);
  const cost = multiplyMoney(row.unitCost, row.qty);
  const base = multiplyMoney(row.listPrice, row.qty);
  const fee = row.payment === "card" ? feeMoney(revenue, row.rate) : 0;
  return {
    ...row,
    revenue,
    cost,
    base,
    discount: subtractMoney(base, revenue),
    fee,
    ...calculateMetrics(revenue, cost, fee),
  };
}
export type CalculatedLine = ReturnType<typeof calculateLine>;
export function calculateMetrics(revenue: number, cost: number, fee: number) {
  const gross = subtractMoney(revenue, cost);
  return {
    gross,
    afterFee: subtractMoney(gross, fee),
    margin: percent(gross, revenue),
    markup: percent(gross, cost),
  };
}
export function calculateTotals(rows: CalculatedLine[]) {
  const revenue = sumMoney(rows.map((row) => row.revenue));
  const cost = sumMoney(rows.map((row) => row.cost));
  const fee = sumMoney(rows.map((row) => row.fee));
  return {
    revenue,
    cost,
    fee,
    ...calculateMetrics(revenue, cost, fee),
    discount: sumMoney(rows.map((row) => row.discount)),
    cash: sumMoney(rows.filter((row) => row.payment === "cash").map((row) => row.revenue)),
    card: sumMoney(rows.filter((row) => row.payment === "card").map((row) => row.revenue)),
    preliminaryCost: sumMoney(rows.filter((row) => row.preliminary).map((row) => row.cost)),
    preliminaryLines: rows.filter((row) => row.preliminary).length,
  };
}

export function todayMoscow() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function daysBetween(earlier: string, later: string) {
  return Math.floor(
    (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86400000,
  );
}

export const priceChangeSchema = z.object({
  ...common,
  productId: id,
  price: money,
  expectedRevision: z.number().int().nonnegative(),
  expectedPrice: z.number().int().nonnegative().nullable(),
  reason: z.string().trim().min(3).max(1000),
});
