export const sections = {
  overview: "Обзор",
  sales: "Продажи",
  products: "Товары",
  stock: "Остатки",
  documents: "Документы",
  locations: "Места хранения",
  production: "Производство",
  "production-quote": "Расчёт выпуска",
  calculator: "Калькулятор себестоимости",
  competitors: "Цены конкурентов",
  settings: "Настройки",
} as const;

export type Section = keyof typeof sections;

export function isSection(value: string): value is Section {
  return Object.hasOwn(sections, value);
}
