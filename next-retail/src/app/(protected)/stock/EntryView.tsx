"use client";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { calculateLine, calculateTotals } from "../../../domain/store-sales";
import { breakEven, formatMoney, moneyInput, rateInput, rubles } from "../../../domain/money";
import type {
  LotOption,
  ProductOption,
  StoreLedger,
  StoreOverview,
} from "../../../server/store-ledger";
import { postStoreDocument, searchStoreLots } from "../sales/actions";
import ProductPicker from "./ProductPicker";
import { useNavigationLock } from "../NavigationProtection";
import { stockOwnerOptions, type StockOwner } from "../../../domain/stock-owners";

type SaleRow = {
  key: string;
  lot: LotOption;
  qty: number;
  price: string;
  payment: "cash" | "card";
  rate: string;
};
type ReceiptRow = {
  key: string;
  product: ProductOption;
  qty: number;
  unitCost: string;
  salePrice: string;
  priceRevision: number;
  owner: StockOwner | null;
  preliminary: boolean;
  originDate: string;
  expiryDate: string;
};
const titles: Record<string, string> = {
  sale: "Новая продажа",
  receipt: "Приёмка товара",
  inventory: "Инвентаризация",
  expense: "Расход магазина",
  transfer: "Перемещение товара",
  writeoff: "Списание товара",
};

export default function EntryView({
  shops,
  mode,
  initialShop,
  today,
  stockMonth = "",
  edit,
}: {
  shops: StoreOverview["shops"];
  mode: string;
  initialShop: string;
  today: string;
  stockMonth?: string;
  edit?: ReturnType<StoreLedger["edit"]>;
}) {
  const router = useRouter();
  const receipt = mode === "receipt";
  const [pending, start] = useTransition();
  const requestKey = useRef<string | null>(null);
  const requestVersion = useRef(0);
  const defaultShopId = shops.some((shop) => shop.id === initialShop) ? initialShop : "";
  const [shopId, setShopId] = useState(defaultShopId);
  const [date, setDate] = useState(edit?.date ?? today);
  const [note, setNote] = useState(edit?.note ?? "");
  const [error, setError] = useState("");
  const [lots, setLots] = useState<LotOption[]>([]);
  const [originalSaleRows] = useState<SaleRow[]>(
    () =>
      edit?.rows.map(({ row, lot }, index) => ({
        key: `saved-${index}`,
        lot,
        qty: row.qty,
        price: rubles(row.price),
        payment: row.payment,
        rate: row.rate,
      })) ?? [],
  );
  const [saleRows, setSaleRows] = useState(originalSaleRows);
  const [receiptRows, setReceiptRows] = useState<ReceiptRow[]>([]);
  const [payment, setPayment] = useState<"cash" | "card">("cash");
  const [rate, setRate] = useState("");
  const [initial, setInitial] = useState(true);
  const [countLot, setCountLot] = useState<LotOption | null>(null);
  const [actual, setActual] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [query, setQuery] = useState("");
  const [dispatchRows, setDispatchRows] = useState<{ lot: LotOption; qty: number | null }[]>([]);
  const [destinationShopId, setDestinationShopId] = useState("");
  const dispatch = mode === "transfer" || mode === "writeoff";
  const dirty =
    shopId !== defaultShopId ||
    date !== (edit?.date ?? today) ||
    note !== (edit?.note ?? "") ||
    saleRows !== originalSaleRows ||
    payment !== "cash" ||
    !!rate ||
    !!countLot ||
    actual !== null ||
    !!reason ||
    !!category ||
    !!amount ||
    dispatchRows.length > 0 ||
    !!destinationShopId;
  const unlockForm = useNavigationLock(!receipt && dirty);
  const search = async (text: string) => {
    setQuery(text);
    const version = ++requestVersion.current;
    try {
      if (shopId) {
        const result = await searchStoreLots(shopId, text, mode === "inventory");
        if (version === requestVersion.current) setLots(result);
      }
    } catch {
      setError("Не удалось загрузить список товаров");
    }
  };
  let preview: ReturnType<typeof calculateTotals> | null = null;
  try {
    preview = calculateTotals(
      saleRows.map((row) =>
        calculateLine({
          lotId: row.lot.id,
          productId: row.lot.productId,
          name: row.lot.name,
          code: row.lot.code,
          qty: row.qty,
          unitCost: row.lot.unitCost,
          listPrice: row.lot.price ?? 0,
          price: moneyInput(row.price),
          preliminary: row.lot.preliminary,
          payment: row.payment,
          rate: row.payment === "card" ? rateInput(row.rate) : "0",
        }),
      ),
    );
  } catch {
    preview = null;
  }
  const updateSale = (key: string, patch: Partial<SaleRow>) =>
    setSaleRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const updateReceipt = (key: string, patch: Partial<ReceiptRow>) =>
    setReceiptRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const save = () =>
    start(async () => {
      setError("");
      if (!requestKey.current) requestKey.current = crypto.randomUUID();
      const common = { key: requestKey.current, shopId, date, note };
      let payload: unknown;
      if (mode === "sale")
        payload = {
          ...common,
          ...(edit ? { documentId: edit.id, revision: edit.revision, reason } : {}),
          rows: saleRows.map((row) => ({
            lotId: row.lot.id,
            qty: row.qty,
            price: row.price,
            expectedListPrice: row.lot.price,
            payment: row.payment,
            rate: row.rate,
          })),
        };
      else if (mode === "receipt")
        payload = {
          ...common,
          initial,
          rows: receiptRows.map((row) => ({
            productId: row.product.id,
            qty: row.qty,
            unitCost: row.unitCost,
            salePrice: row.salePrice || undefined,
            priceRevision: row.priceRevision,
            owner: row.owner ?? undefined,
            preliminary: row.preliminary,
            originDate: row.originDate || null,
            expiryDate: row.expiryDate || null,
          })),
        };
      else if (mode === "inventory")
        payload = { ...common, lotId: countLot?.id, expected: countLot?.remaining, actual, reason };
      else if (dispatch)
        payload = {
          ...common,
          destinationShopId,
          reason,
          rows: dispatchRows.map(({ lot, qty }) => ({ lotId: lot.id, qty })),
        };
      else payload = { ...common, category, amount };
      const result = await postStoreDocument(edit ? "revision" : mode, payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      unlockForm();
      requestKey.current = null;
      router.push(
        `${mode === "sale" || mode === "expense" ? "/sales" : "/stock"}?tab=journal&shop=${encodeURIComponent(shopId)}&month=${date.slice(0, 7)}`,
      );
      router.refresh();
    });
  if (!shops.length)
    return (
      <Alert
        type="info"
        title="Сначала создайте два магазина"
        description={<Link href="/sales">Перейти к настройке</Link>}
      />
    );
  const stockMode = mode === "inventory" || dispatch;
  const journalTab = mode === "inventory" ? "inventory" : "journal";
  const journalQuery = new URLSearchParams({
    tab: journalTab,
    ...(shopId ? { shop: shopId } : {}),
    ...(stockMonth ? { month: stockMonth } : {}),
  });
  return (
    <Space orientation="vertical" size={20} style={{ width: "100%" }}>
      <Space>
        {!receipt && (
          <Link href={stockMode ? `/stock?${journalQuery}` : "/sales"}>
            {mode === "inventory"
              ? "← Журнал инвентаризаций"
              : dispatch
                ? "← Журнал склада"
                : "← Назад"}
          </Link>
        )}
        <Typography.Title level={2} style={{ margin: 0 }}>
          {edit ? `Исправление ежедневного отчёта · версия ${edit.revision}` : titles[mode]}
        </Typography.Title>
      </Space>
      {error && <Alert type="error" showIcon title={error} />}
      <Card>
        <Space wrap align="end">
          <label>
            {mode === "transfer" ? "Откуда" : "Магазин"}
            <br />
            <Select
              aria-label="Магазин документа"
              style={{ width: 260 }}
              value={shopId || undefined}
              placeholder="Выбери магазин"
              disabled={
                pending ||
                saleRows.length > 0 ||
                receiptRows.length > 0 ||
                Boolean(countLot) ||
                dispatchRows.length > 0
              }
              options={shops.map((shop) => ({ value: shop.id, label: shop.name }))}
              onChange={(value) => {
                setShopId(value);
                if (destinationShopId === value) setDestinationShopId("");
                setLots([]);
                setCountLot(null);
                setQuery("");
                requestVersion.current++;
              }}
            />
          </label>
          {mode === "transfer" && (
            <label>
              Куда
              <br />
              <Select
                aria-label="Магазин назначения"
                style={{ width: 260 }}
                value={destinationShopId || undefined}
                placeholder="Выбери магазин"
                disabled={pending || !shopId}
                options={shops
                  .filter((shop) => shop.id !== shopId)
                  .map((shop) => ({ value: shop.id, label: shop.name }))}
                onChange={setDestinationShopId}
              />
            </label>
          )}
          <label>
            Дата документа
            <br />
            <Input
              aria-label="Дата документа"
              type="date"
              value={date}
              max={today}
              disabled={Boolean(edit)}
              onChange={(event) => setDate(event.target.value)}
              style={{ width: 190 }}
            />
          </label>
          {mode === "receipt" && (
            <Checkbox checked={initial} onChange={(event) => setInitial(event.target.checked)}>
              Ввод начальных остатков
            </Checkbox>
          )}
        </Space>
      </Card>
      {mode === "sale" && (
        <Card title="Проданные позиции">
          <Space wrap style={{ marginBottom: 20 }}>
            <Select
              aria-label="Оплата новых позиций"
              style={{ width: 220 }}
              value={payment}
              options={[
                { value: "cash", label: "Наличные" },
                { value: "card", label: "Карта" },
              ]}
              onChange={setPayment}
            />
            <Input
              aria-label="Тариф карты для новых позиций"
              style={{ width: 220 }}
              placeholder="Тариф карты, %"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
            />
          </Space>
          <Select
            aria-label="Выбрать проданный товар"
            showSearch
            filterOption={false}
            value={undefined}
            searchValue={query}
            onSearch={search}
            onOpenChange={(open) => {
              if (open) void search("");
            }}
            disabled={!shopId || pending}
            style={{ width: "100%", marginBottom: 20 }}
            placeholder="Найти товар и выбрать партию магазина"
            options={lots.map((lot) => ({
              value: lot.id,
              label: `${lot.name} · ${lot.date} · остаток ${lot.remaining} шт. · себестоимость ${formatMoney(lot.unitCost)}`,
              disabled: lot.price === null || Boolean(lot.expiryDate && lot.expiryDate < date),
            }))}
            onSelect={(id) => {
              const lot = lots.find((item) => item.id === id)!;
              setSaleRows((rows) => [
                ...rows,
                {
                  key: crypto.randomUUID(),
                  lot,
                  qty: 1,
                  price: lot.price === null ? "" : rubles(lot.price),
                  payment,
                  rate,
                },
              ]);
              setQuery("");
            }}
          />
          <Table
            rowKey="key"
            dataSource={saleRows}
            pagination={false}
            scroll={{ x: 1200 }}
            columns={[
              {
                title: "Товар / партия",
                key: "product",
                width: 260,
                render: (_, row) => (
                  <>
                    {row.lot.name}
                    <div>
                      <Typography.Text type="secondary">
                        {row.lot.date} · доступно {row.lot.remaining} шт.
                      </Typography.Text>
                    </div>
                    {row.lot.preliminary && <Tag color="orange">Предварительная стоимость</Tag>}
                  </>
                ),
              },
              {
                title: "Кол-во",
                key: "qty",
                render: (_, row) => (
                  <InputNumber
                    aria-label={`Количество ${row.lot.name}`}
                    min={1}
                    max={row.lot.remaining}
                    precision={0}
                    value={row.qty}
                    onChange={(value) => updateSale(row.key, { qty: value ?? 1 })}
                  />
                ),
              },
              {
                title: "Цена / шт., ₽",
                key: "price",
                render: (_, row) => (
                  <Input
                    aria-label={`Цена ${row.lot.name}`}
                    style={{ width: 120 }}
                    value={row.price}
                    onChange={(event) => updateSale(row.key, { price: event.target.value })}
                  />
                ),
              },
              {
                title: "Оплата",
                key: "payment",
                render: (_, row) => (
                  <Select
                    aria-label={`Оплата ${row.lot.name}`}
                    value={row.payment}
                    style={{ width: 130 }}
                    options={[
                      { value: "cash", label: "Наличные" },
                      { value: "card", label: "Карта" },
                    ]}
                    onChange={(value) => updateSale(row.key, { payment: value })}
                  />
                ),
              },
              {
                title: "Тариф, %",
                key: "rate",
                render: (_, row) => (
                  <Input
                    aria-label={`Тариф ${row.lot.name}`}
                    style={{ width: 90 }}
                    disabled={row.payment === "cash"}
                    value={row.payment === "cash" ? "0" : row.rate}
                    onChange={(event) => updateSale(row.key, { rate: event.target.value })}
                  />
                ),
              },
              {
                title: "Цена покрытия затрат",
                key: "limit",
                render: (_, row) => {
                  try {
                    return formatMoney(
                      breakEven(row.lot.unitCost, row.payment === "cash" ? "0" : row.rate),
                    );
                  } catch {
                    return "Укажи тариф";
                  }
                },
              },
              {
                key: "remove",
                render: (_, row) => (
                  <Button
                    danger
                    onClick={() =>
                      setSaleRows((rows) => rows.filter((item) => item.key !== row.key))
                    }
                  >
                    Убрать
                  </Button>
                ),
              },
            ]}
          />
          <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
            Цена покрытия включает себестоимость и комиссию этой оплаты. Общие расходы, налоги и
            желаемый заработок в ней не учтены.
          </Typography.Paragraph>
        </Card>
      )}
      {mode === "sale" && (
        <Card title="Расчёт продажи">
          {preview ? (
            <>
              <Descriptions
                column={{ xs: 1, md: 3 }}
                items={[
                  { key: "rev", label: "Выручка", children: formatMoney(preview.revenue) },
                  { key: "cost", label: "Себестоимость", children: formatMoney(preview.cost) },
                  { key: "gross", label: "Валовая прибыль", children: formatMoney(preview.gross) },
                  { key: "fee", label: "Эквайринг", children: formatMoney(preview.fee) },
                  {
                    key: "after",
                    label: "После эквайринга",
                    children: formatMoney(preview.afterFee),
                  },
                  { key: "discount", label: "Скидка", children: formatMoney(preview.discount) },
                  {
                    key: "margin",
                    label: "Валовая маржа",
                    children: preview.margin === null ? "—" : `${preview.margin}%`,
                  },
                  {
                    key: "markup",
                    label: "Наценка",
                    children: preview.markup === null ? "—" : `${preview.markup}%`,
                  },
                ]}
              />
              {preview.afterFee < 0 && (
                <Alert
                  style={{ marginTop: 16 }}
                  type="warning"
                  title="Продажа принесёт убыток после комиссии"
                />
              )}
            </>
          ) : (
            <Alert type="info" title="Заполните корректную цену и тариф для расчёта" />
          )}
        </Card>
      )}
      {mode === "receipt" && (
        <Card title="Товары документа">
          <div style={{ marginBottom: 16 }}>
            <ProductPicker
              disabled={!shopId || pending}
              shopId={shopId}
              remainingLines={200 - receiptRows.length}
              onAdd={(selected) =>
                setReceiptRows((rows) => [
                  ...rows,
                  ...selected.map((item) => ({
                    key: crypto.randomUUID(),
                    product: item.product,
                    qty: item.qty,
                    unitCost:
                      item.unitCost ??
                      (item.suggestedCost === null ? "" : rubles(item.suggestedCost)),
                    salePrice:
                      item.salePriceInput ??
                      (item.salePrice === null ? "" : rubles(item.salePrice)),
                    priceRevision: item.priceRevision,
                    owner: item.owner ?? null,
                    preliminary: true,
                    originDate: "",
                    expiryDate: "",
                  })),
                ])
              }
            />
          </div>
          <Typography.Paragraph type="secondary">
            Продажная цена после проведения применяется ко всем партиям товара в выбранном магазине.
            Каталог и себестоимость старых партий не меняются. Пустая продажная цена сохраняет
            текущую. Проверьте полную себестоимость готовой штуки. Цена из каталога предварительная;
            её можно исправить перед проведением.
          </Typography.Paragraph>
          <Table
            rowKey="key"
            dataSource={receiptRows}
            pagination={false}
            locale={{ emptyText: "Добавьте товары из каталога" }}
            scroll={{ x: 1690 }}
            columns={[
              { title: "Товар", key: "name", width: 280, render: (_, row) => row.product.name },
              {
                title: "Владелец",
                key: "owner",
                width: 140,
                render: (_, row) => (
                  <Select<StockOwner>
                    aria-label={`Владелец партии ${row.product.name}`}
                    allowClear
                    placeholder="—"
                    value={row.owner ?? undefined}
                    options={stockOwnerOptions}
                    style={{ width: "100%" }}
                    onChange={(owner) => updateReceipt(row.key, { owner: owner ?? null })}
                  />
                ),
              },
              {
                title: "Кол-во, шт.",
                key: "qty",
                render: (_, row) => (
                  <InputNumber
                    aria-label={`Приход ${row.product.name}`}
                    min={1}
                    max={100000}
                    precision={0}
                    value={row.qty}
                    onChange={(value) => updateReceipt(row.key, { qty: value ?? 1 })}
                  />
                ),
              },
              {
                title: "Себестоимость / шт., ₽",
                key: "cost",
                render: (_, row) => (
                  <Input
                    aria-label={`Себестоимость ${row.product.name}`}
                    value={row.unitCost}
                    style={{ width: 130 }}
                    onChange={(event) => updateReceipt(row.key, { unitCost: event.target.value })}
                  />
                ),
              },
              {
                title: <span style={{ whiteSpace: "nowrap" }}>Цена продажи / шт., ₽</span>,
                key: "salePrice",
                render: (_, row) => (
                  <Input
                    aria-label={`Продажная цена ${row.product.name}`}
                    inputMode="decimal"
                    value={row.salePrice}
                    style={{ width: 140 }}
                    onChange={(event) => updateReceipt(row.key, { salePrice: event.target.value })}
                  />
                ),
              },
              {
                title: "Оценка",
                key: "quality",
                render: (_, row) => (
                  <Checkbox
                    checked={row.preliminary}
                    onChange={(event) =>
                      updateReceipt(row.key, { preliminary: event.target.checked })
                    }
                  >
                    Предварительная
                  </Checkbox>
                ),
              },
              {
                title: "Исходная дата партии",
                key: "origin",
                render: (_, row) => (
                  <Input
                    aria-label={`Исходная дата ${row.product.name}`}
                    type="date"
                    max={date}
                    value={row.originDate}
                    onChange={(event) => updateReceipt(row.key, { originDate: event.target.value })}
                  />
                ),
              },
              {
                title: "Годен до",
                key: "expiry",
                render: (_, row) => (
                  <Input
                    aria-label={`Срок годности ${row.product.name}`}
                    type="date"
                    value={row.expiryDate}
                    onChange={(event) => updateReceipt(row.key, { expiryDate: event.target.value })}
                  />
                ),
              },
              {
                key: "remove",
                render: (_, row) => (
                  <Button
                    danger
                    onClick={() =>
                      setReceiptRows((rows) => rows.filter((item) => item.key !== row.key))
                    }
                  >
                    Убрать
                  </Button>
                ),
              },
            ]}
          />
          <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
            Исходная дата нужна для возраста товара. Оставь её пустой, если не знаешь. Дата ввода
            начального наличия сама по себе не означает, что товар свежий.
          </Typography.Paragraph>
        </Card>
      )}
      {mode === "inventory" && (
        <Card title="Сверка фактического наличия">
          <Space orientation="vertical" style={{ width: "100%" }} size={16}>
            <Select
              aria-label="Партия для пересчёта"
              showSearch
              filterOption={false}
              value={countLot?.id}
              onSearch={search}
              onOpenChange={(open) => {
                if (open) void search("");
              }}
              disabled={!shopId || pending}
              style={{ width: "100%" }}
              placeholder="Выбери партию магазина"
              options={lots.map((lot) => ({
                value: lot.id,
                label: `${lot.name} · ${lot.date} · учёт ${lot.remaining} шт.`,
              }))}
              onSelect={(id) => {
                const lot = lots.find((item) => item.id === id)!;
                setCountLot(lot);
                setActual(lot.remaining);
              }}
            />
            {countLot && (
              <Typography.Text>
                По учёту {countLot.remaining} шт. Себестоимость {formatMoney(countLot.unitCost)} за
                штуку.
              </Typography.Text>
            )}
            <label>
              Посчитано фактически, шт.
              <br />
              <InputNumber
                aria-label="Фактическое количество"
                min={0}
                max={100000}
                precision={0}
                value={actual}
                onChange={setActual}
              />
            </label>
            <Input.TextArea
              aria-label="Причина расхождения"
              placeholder="Причина расхождения"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={1000}
            />
            <Alert
              type="info"
              title="Корректировка сохраняется отдельным документом"
              description="При нехватке стоимость спишется в недостачи месяца. При излишке появится отдельная партия с той же оценкой и неизвестным возрастом. Если учёт изменится во время пересчёта, потребуется обновить данные."
            />
          </Space>
        </Card>
      )}
      {dispatch && (
        <Card title={mode === "transfer" ? "Партии для перемещения" : "Партии для списания"}>
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Select
              aria-label="Добавить партию"
              showSearch
              filterOption={false}
              onSearch={search}
              onOpenChange={(open) => {
                if (open) void search("");
              }}
              disabled={!shopId || pending || dispatchRows.length >= 200}
              style={{ width: "100%" }}
              placeholder="Найди товар и выбери партию"
              options={lots
                .filter((lot) => !dispatchRows.some((row) => row.lot.id === lot.id))
                .map((lot) => ({
                  value: lot.id,
                  label: `${lot.name} · ${lot.date} · ${lot.remaining} шт. · ${formatMoney(lot.unitCost)}${lot.owner ? ` · ${lot.owner}` : ""} · ${lot.id.slice(0, 8)}`,
                }))}
              onSelect={(id) => {
                const lot = lots.find((item) => item.id === id);
                if (lot) setDispatchRows((rows) => [...rows, { lot, qty: 1 }]);
              }}
            />
            <Table
              rowKey={(row) => row.lot.id}
              dataSource={dispatchRows}
              pagination={false}
              scroll={{ x: 690 }}
              columns={[
                { title: "Товар", width: 260, render: (_, row) => row.lot.name },
                {
                  title: "Партия",
                  render: (_, row) => `${row.lot.date} · ${row.lot.id.slice(0, 8)}`,
                },
                { title: "Остаток, шт.", align: "right", render: (_, row) => row.lot.remaining },
                {
                  title: "Себестоимость / шт.",
                  align: "right",
                  render: (_, row) => formatMoney(row.lot.unitCost),
                },
                {
                  title: "Количество, шт.",
                  render: (_, row) => (
                    <InputNumber
                      aria-label={`Количество ${row.lot.name}`}
                      min={1}
                      max={row.lot.remaining}
                      precision={0}
                      disabled={pending}
                      value={row.qty}
                      onChange={(qty) =>
                        setDispatchRows((rows) =>
                          rows.map((item) =>
                            item.lot.id === row.lot.id ? { ...item, qty } : item,
                          ),
                        )
                      }
                    />
                  ),
                },
                {
                  title: "Действия",
                  render: (_, row) => (
                    <Button
                      disabled={pending}
                      onClick={() =>
                        setDispatchRows((rows) => rows.filter((item) => item.lot.id !== row.lot.id))
                      }
                    >
                      Убрать
                    </Button>
                  ),
                },
              ]}
            />
            {mode === "writeoff" && (
              <Input.TextArea
                aria-label="Причина списания"
                placeholder="Причина списания — например, тестер или брак"
                value={reason}
                disabled={pending}
                maxLength={1000}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Space>
        </Card>
      )}
      {mode === "expense" && (
        <Card title="Расходы периода">
          <Space orientation="vertical" style={{ width: "100%", maxWidth: 600 }} size={16}>
            <Input
              aria-label="Статья расхода"
              placeholder="Статья — например, аренда"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              maxLength={100}
            />
            <Input
              aria-label="Сумма расхода"
              placeholder="Сумма, ₽"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <Alert
              type="info"
              title="Вноси расходы, которые ещё не учтены"
              description="Стоимость готового товара и эквайринг уже вычитаются автоматически. Повторно сюда их записывать не нужно."
            />
          </Space>
        </Card>
      )}
      <Card>
        <Space orientation="vertical" style={{ width: "100%" }}>
          {edit && (
            <Input.TextArea
              aria-label="Причина исправления отчёта"
              placeholder="Причина исправления — обязательно"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={1000}
            />
          )}
          <Input.TextArea
            aria-label="Примечание документа"
            placeholder="Примечание, необязательно"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={1000}
          />
          <Button
            type="primary"
            size="large"
            loading={pending}
            disabled={
              !shopId ||
              (mode === "sale" && !saleRows.length) ||
              (mode === "receipt" && !receiptRows.length) ||
              (mode === "inventory" && !countLot) ||
              (dispatch && (!dispatchRows.length || dispatchRows.some((row) => !row.qty))) ||
              (mode === "transfer" && !destinationShopId) ||
              (mode === "writeoff" && reason.trim().length < 3) ||
              (Boolean(edit) && reason.trim().length < 3)
            }
            onClick={save}
          >
            {edit
              ? "Сохранить новую версию отчёта"
              : mode === "receipt"
                ? "Провести приёмку"
                : mode === "transfer"
                  ? "Провести перемещение"
                  : mode === "writeoff"
                    ? "Провести списание"
                    : "Провести документ"}
          </Button>
        </Space>
      </Card>
    </Space>
  );
}
