import { requireLocalAdmin } from "../../../../server/local-auth";
import { getStoreLedger } from "../../../../server/store-runtime";
import EntryView from "../EntryView";

export default async function StockEntryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireLocalAdmin();
  const params = await searchParams;
  const mode = ["inventory", "transfer", "writeoff"].includes(params.mode ?? "")
    ? params.mode!
    : "receipt";
  const shop = typeof params.shop === "string" ? params.shop : "";
  const month = typeof params.month === "string" ? params.month : "";
  const data = getStoreLedger().overview();
  return (
    <EntryView
      shops={data.shops}
      key={`${mode}:${shop}`}
      mode={mode}
      initialShop={shop}
      stockMonth={month}
      today={data.today}
    />
  );
}
