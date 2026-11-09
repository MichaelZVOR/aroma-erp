import { requireLocalAdmin } from "../../../server/local-auth";
import { getStoreLedger } from "../../../server/store-runtime";
import SalesView from "./SalesView";
export default async function SalesPage({
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
    tab: value("tab") || "overview",
    page: Number(value("page")) || 1,
    age: Number(value("age")) || 0,
    status: ["posted", "reversed"].includes(value("status")) ? value("status") : "",
  };
  return (
    <SalesView
      data={getStoreLedger().overview({
        ...filters,
        documentKinds: ["sale", "reversal", "expense"],
      })}
      filters={filters}
    />
  );
}
