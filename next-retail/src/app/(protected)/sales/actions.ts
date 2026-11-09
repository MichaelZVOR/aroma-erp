"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireLocalAdmin } from "../../../server/local-auth";
import { getStoreLedger, refreshReceiptCatalogue } from "../../../server/store-runtime";
import { productImages } from "../../../server/product-images";

export async function postStoreDocument(kind: string, payload: unknown) {
  const user = await requireLocalAdmin();
  try {
    const ledger = getStoreLedger();
    let id: string;
    switch (kind) {
      case "price":
        id = ledger.changePrice(payload, user.name).id;
        break;
      case "receipt":
        id = ledger.receipt(payload, user.name).id;
        break;
      case "sale":
        id = ledger.sale(payload, user.name).id;
        break;
      case "inventory":
        id = ledger.inventory(payload, user.name).id;
        break;
      case "transfer":
      case "writeoff":
        id = ledger.dispatchStock({ ...(payload as object), kind }, user.name).id;
        break;
      case "expense":
        id = ledger.expense(payload, user.name).id;
        break;
      case "reversal":
        id = ledger.cancel(payload, user.name).id;
        break;
      case "revision":
        id = ledger.revise(payload, user.name).id;
        break;
      default:
        throw new Error("Неизвестный вид документа");
    }
    revalidatePath("/sales");
    revalidatePath("/stock");
    return { ok: true as const, id };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof ZodError
          ? error.issues.map((issue) => issue.message).join(". ")
          : error instanceof Error
            ? error.message
            : "Не удалось сохранить документ",
    };
  }
}
export async function setupStores(names: string[]) {
  await requireLocalAdmin();
  try {
    getStoreLedger().createShops(names);
    revalidatePath("/sales");
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Ошибка создания магазинов",
    };
  }
}
export async function searchStoreProducts(query: string) {
  await requireLocalAdmin();
  return getStoreLedger().findProducts(query);
}
export async function searchStoreLots(shopId: string, query: string, includeEmpty = false) {
  await requireLocalAdmin();
  return getStoreLedger().findLots(shopId, query, includeEmpty);
}
export async function readStoreHistory(id: string) {
  await requireLocalAdmin();
  return getStoreLedger().history(id);
}
export async function browseStoreCatalogue(
  query: string,
  category: string,
  page: number,
  shopId = "",
) {
  await requireLocalAdmin();
  if (!query && !category && page === 1) refreshReceiptCatalogue();
  const catalogue = getStoreLedger().browseProducts(query, category, page, shopId);
  const images = productImages(catalogue.rows.map(({ product }) => product));
  return {
    ...catalogue,
    rows: catalogue.rows.map((row) => ({ ...row, image: images.get(row.product.id) ?? null })),
  };
}

export async function readShopPriceHistory(shopId: string, productId: string) {
  await requireLocalAdmin();
  return getStoreLedger().priceHistory(shopId, productId);
}
