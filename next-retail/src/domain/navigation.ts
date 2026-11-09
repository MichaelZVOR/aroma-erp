import productCategories from "./product-categories.json";

export const legacyPages = {
  overview: "home",
  products: "goods",
  production: "production",
  "production-quote": "stockcalc",
  calculator: "calc",
  competitors: "competitors",
  settings: "settings",
  documents: "documents",
  locations: "warehouse",
} as const;
export type LegacySection = keyof typeof legacyPages;
const routes: Record<string, string> = {
  home: "/overview",
  goods: "/products",
  catalog: "/products",
  sales: "/sales",
  warehouse: "/stock",
  receipts: "/stock?tab=receipts",
  stock: "/stock?tab=stock",
  inventory: "/stock?tab=inventory",
  documents: "/documents",
  production: "/production",
  stockcalc: "/production-quote",
  calc: "/calculator",
  competitors: "/competitors",
  settings: "/settings",
  bottles: "/products?legacy=bottles",
  liquid: "/products?legacy=liquid",
  decants: "/products?legacy=decants",
  import: "/products?legacy=import",
};
export function legacyRoute(page: unknown): string | null {
  return typeof page === "string" && Object.hasOwn(routes, page) ? routes[page] : null;
}
export function isLegacySection(section: string): section is LegacySection {
  return Object.hasOwn(legacyPages, section);
}
export function legacySource(section: LegacySection, category?: string, productKind?: string) {
  const allowed = ["goods", "catalog", "bottles", "liquid", "decants", "import"];
  const page =
    section === "products" && category && allowed.includes(category)
      ? category
      : legacyPages[section];
  const kind =
    section === "products" &&
    (productCategories.some(({ key }) => key === productKind && key !== "import") ||
      ["liquid", "label", "other"].includes(productKind ?? ""))
      ? `&category=${productKind}`
      : "";
  return `http://127.0.0.1:8788/?embed=1${kind}#${page}`;
}
