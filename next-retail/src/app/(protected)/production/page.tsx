import { requireLocalAdmin } from "../../../server/local-auth";
import { getStoreLedger } from "../../../server/store-runtime";
import ProductionView from "./ProductionView";

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireLocalAdmin();
  const params = await searchParams;
  const ledger = getStoreLedger();
  const mode =
    params.tab === "journal" || params.tab === "quote" || params.tab === "materials"
      ? params.tab
      : "release";
  const journal = ledger.overview({
    documentKinds: ["production"],
    shopId: typeof params.shop === "string" ? params.shop : "",
    month: typeof params.month === "string" ? params.month : "",
    page: typeof params.page === "string" ? Number(params.page) : 1,
  });
  const shopId =
    journal.shops.find((shop) => shop.id === params.shop)?.id ??
    (mode === "journal" ? "" : (journal.shops[0]?.id ?? ""));
  return (
    <ProductionView
      key={`${mode}:${shopId}`}
      mode={mode}
      shopId={shopId}
      journal={journal}
      options={
        mode === "journal" ? { materials: [], opened: [] } : ledger.productionOptions(shopId)
      }
    />
  );
}
