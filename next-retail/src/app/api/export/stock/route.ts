import { getLocalSession } from "../../../../server/local-auth";
import { isLocalSameOrigin } from "../../../../server/request-origin";
import { getStoreLedger } from "../../../../server/store-runtime";
import { bifitCatalogCsv, fillStockTemplate, stockReportCsv } from "../../../../domain/stock-csv";
function download(text: string, name: string) {
  return new Response(text, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
export async function GET(request: Request) {
  if (!(await getLocalSession()).user) return new Response("Unauthorized", { status: 401 });
  try {
    const params = new URL(request.url).searchParams;
    const shop = params.get("shop") || undefined;
    const format = params.get("format");
    if (format === "bifit" && !shop) throw new Error("Выберите один магазин");
    const rows = getStoreLedger().exportStock(shop);
    return download(
      format === "bifit" ? bifitCatalogCsv(rows) : stockReportCsv(rows),
      format === "bifit" ? "bifit-goods" : "stock",
    );
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Ошибка выгрузки", {
      status: 400,
    });
  }
}
export async function POST(request: Request) {
  if (!(await getLocalSession()).user) return new Response("Unauthorized", { status: 401 });
  if (!isLocalSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  try {
    const form = await request.formData();
    const file = form.get("template");
    const shopId = String(form.get("shop") ?? "");
    if (!shopId) throw new Error("Выберите магазин");
    if (!(file instanceof File) || file.size > 10_000_000)
      throw new Error("Выберите CSV-шаблон до 10 МБ");
    const encoding = form.get("encoding") === "windows-1251" ? "windows-1251" : "utf-8";
    const text = new TextDecoder(encoding, { fatal: true }).decode(await file.arrayBuffer());
    const result = fillStockTemplate(
      getStoreLedger().exportStock(shopId),
      text,
      String(form.get("identifierColumn")),
      String(form.get("quantityColumn")),
      String(form.get("identifierType")),
      String(form.get("separator") ?? ";"),
    );
    return download(result, "bifit-stock");
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Ошибка обработки шаблона", {
      status: 400,
    });
  }
}
