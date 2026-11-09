import Decimal from "decimal.js";

const Exact = Decimal.clone({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });
const MAX = 10_000_000_000;

export function moneyInput(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Введите сумму в рублях, не более двух знаков после запятой");
  }
  const cents = new Exact(normalized).times(100).toNumber();
  if (!Number.isSafeInteger(cents) || cents > MAX) throw new Error("Слишком большая сумма");
  return cents;
}

export function rateInput(value: string): string {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(normalized)) throw new Error("Укажите тариф от 0 до 99,99%");
  return new Exact(normalized).toString();
}

export function sumMoney(values: number[]): number {
  const result = values.reduce((sum, value) => sum.plus(value), new Exact(0)).toNumber();
  if (!Number.isSafeInteger(result)) throw new Error("Слишком большая итоговая сумма");
  return result;
}

export function subtractMoney(left: number, right: number): number {
  return sumMoney([left, -right]);
}

export function multiplyMoney(cents: number, quantity: number): number {
  const value = new Exact(cents).times(quantity).toNumber();
  if (!Number.isSafeInteger(value)) throw new Error("Слишком большая сумма строки");
  return value;
}

export function feeMoney(cents: number, rate: string): number {
  return new Exact(cents)
    .times(rateInput(rate))
    .div(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function percent(numerator: number, denominator: number): string | null {
  return denominator === 0
    ? null
    : new Exact(numerator)
        .div(denominator)
        .times(100)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        .toString();
}

export function breakEven(cents: number, rate: string): number {
  return new Exact(cents)
    .div(new Exact(1).minus(new Exact(rateInput(rate)).div(100)))
    .ceil()
    .toNumber();
}

export function formatMoney(cents: number | null): string {
  if (cents === null) return "—";
  return (
    new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(
      new Exact(cents).div(100).toNumber(),
    ) + "\u00a0₽"
  );
}

export function rubles(cents: number): string {
  return new Exact(cents).div(100).toString();
}

export function proportionalMoney(cents: number, quantity: number, balance: number): number {
  return new Exact(cents)
    .times(quantity)
    .div(balance)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}
