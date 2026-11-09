import { requireLocalAdmin } from "../../../../../server/local-auth";
import { getStoreLedger } from "../../../../../server/store-runtime";
import EntryView from "../../../stock/EntryView";
export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireLocalAdmin();
  const { id } = await params;
  const ledger = getStoreLedger();
  const data = ledger.overview();
  const edit = ledger.edit(id);
  return (
    <EntryView
      shops={data.shops}
      mode="sale"
      initialShop={edit.shopId}
      today={data.today}
      edit={edit}
    />
  );
}
