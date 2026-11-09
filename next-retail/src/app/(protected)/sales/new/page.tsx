import { requireLocalAdmin } from "../../../../server/local-auth";
import { getStoreLedger } from "../../../../server/store-runtime";
import EntryView from "../../stock/EntryView";
import { redirect } from "next/navigation";
export default async function EntryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireLocalAdmin();
  const params = await searchParams;
  if (params.mode === "receipt" || params.mode === "inventory") {
    redirect(`/stock/new?${new URLSearchParams({ mode: params.mode, shop: params.shop ?? "" })}`);
  }
  const data = getStoreLedger().overview();
  const mode = ["sale", "expense"].includes(params.mode ?? "") ? params.mode! : "sale";
  return (
    <EntryView
      key={mode}
      shops={data.shops}
      mode={mode}
      initialShop={params.shop ?? ""}
      today={data.today}
    />
  );
}
