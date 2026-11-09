import { z } from "zod";
import { dateSchema } from "./store-sales";
import { moneyInput, multiplyMoney, proportionalMoney, sumMoney } from "./money";

const id = z.string().min(1).max(100);
const money = z.string().min(1).max(30);
export const releaseSchema = z.object({
  shopId: id,
  destinationShopId: id.optional(),
  source: id,
  atom: id,
  label: id,
  volume: z.literal([2, 3, 5, 10]),
  quantity: z.number().int().min(1).max(100000),
  work: money,
  workMode: z.enum(["ml", "unit"]),
  extra: money,
  outputName: z.string().trim().max(240),
});
export const postReleaseSchema = releaseSchema.extend({
  key: id,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  date: dateSchema,
  note: z.string().trim().max(1000).default(""),
});
export const materialSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("atom"),
    name: z.string().trim().min(1).max(160),
    capacity: z.number().int().min(1).max(1000),
  }),
  z.object({ kind: z.literal("label"), name: z.string().trim().min(1).max(160) }),
]);

export function releaseCosts(
  input: z.infer<typeof releaseSchema>,
  source: { balance: number; cost: number },
  atom: number,
  label: number,
) {
  const used = input.volume * input.quantity * 1000;
  const perfumeCost = proportionalMoney(source.cost, used, source.balance);
  const atomCost = multiplyMoney(atom, input.quantity);
  const labelCost = multiplyMoney(label, input.quantity);
  const work = multiplyMoney(
    moneyInput(input.work),
    input.quantity * (input.workMode === "ml" ? input.volume : 1),
  );
  const extra = multiplyMoney(moneyInput(input.extra), input.quantity);
  const total = sumMoney([perfumeCost, atomCost, labelCost, work, extra]);
  const lower = Math.floor(total / input.quantity);
  const higherQty = total % input.quantity;
  const output = [{ quantity: input.quantity - higherQty, unitCost: lower }];
  if (higherQty) output.push({ quantity: higherQty, unitCost: lower + 1 });
  return { used, perfumeCost, atomCost, labelCost, work, extra, total, output };
}

export function decantTitle(name: string, volume: number) {
  return `${name.replace(/\s*[-–—]?\s*\d+(?:[.,]\d+)?\s*(?:мл|ml)\s*$/iu, "").trim()} — ${volume} мл`;
}

export function titleKey(name: string) {
  return name
    .normalize("NFC")
    .toLocaleLowerCase("ru")
    .replace(/[–—−]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
