import { requireLocalAdmin } from "../../../server/local-auth";
import { getStoreLedger } from "../../../server/store-runtime";
import SalesView from "../sales/SalesView";
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireLocalAdmin();
  const params = await searchParams;
  const value = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  const filters = {
    shopId: value("shop"),
    month: value("month"),
    q: value("q"),
    tab: ["receipts", "stock", "inventory", "journal"].includes(value("tab"))
      ? value("tab")
      : "receipts",
    page: Number(value("page")) || 1,
    age: Number(value("age")) || 0,
    status: ["posted", "reversed"].includes(value("status")) ? value("status") : "",
  };
  const documentKinds =
    filters.tab === "receipts"
      ? ["initial", "receipt"]
      : filters.tab === "inventory"
        ? ["inventory"]
        : ["initial", "receipt", "inventory", "price", "transfer", "writeoff"];
  return (
    <SalesView
      data={getStoreLedger().overview({ ...filters, documentKinds })}
      filters={filters}
      workspace="stock"
    />
  );
}
