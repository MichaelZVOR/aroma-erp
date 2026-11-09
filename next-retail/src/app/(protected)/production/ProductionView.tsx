"use client";

import {
  Alert,
  Button,
  Card,
  Descriptions,
  Flex,
  Form,
  Input,
  InputNumber,
  Select,
  Table,
  Typography,
} from "antd";
import Link from "next/link";
import { useNavigationGuard, useNavigationLock } from "../NavigationProtection";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatMoney } from "../../../domain/money";
import type { StoreLedger, StoreOverview } from "../../../server/store-ledger";
import { createProductionMaterial, postRelease, previewRelease } from "./actions";

type Options = ReturnType<StoreLedger["productionOptions"]>;
type Quote = ReturnType<StoreLedger["quoteProduction"]>;
type ReleaseFields = {
  destinationShopId: string;
  source: string;
  atom: string;
  label: string;
  volume: number;
  quantity: number;
  work: string;
  workMode: "ml" | "unit";
  extra: string;
  outputName: string;
  note: string;
};

const headings = {
  release: "Выпуск распивов",
  quote: "Расчёт выпуска",
  journal: "Журнал выпусков",
  materials: "Материалы производства",
};
const dateLabel = (value: string) => value.split("-").reverse().join(".");
const ml = (value: number) => `${(value / 1000).toLocaleString("ru-RU")}\u00a0мл`;
const pcs = (value: number) => `${value.toLocaleString("ru-RU")}\u00a0шт.`;
const cash = (value: number) => <span style={{ whiteSpace: "nowrap" }}>{formatMoney(value)}</span>;

export default function ProductionView({
  mode,
  shopId,
  journal,
  options,
}: {
  mode: keyof typeof headings;
  shopId: string;
  journal: StoreOverview;
  options: Options;
}) {
  const router = useRouter();
  const [form] = Form.useForm<ReleaseFields>();
  const [pending, startTransition] = useTransition();
  const { navigate: guardNavigation } = useNavigationGuard();
  const [dirty, setDirty] = useState(false);
  useNavigationLock(dirty || pending);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [prepared, setPrepared] = useState<{ quote: Quote; input: ReleaseFields; key: string }>();
  const shopOptions = journal.shops.map(({ id, name }) => ({ label: name, value: id }));
  const kind = (value: string) => options.materials.filter(({ product }) => product.kind === value);
  const sourceOptions = [
    ...options.opened.map(({ open, lot, product }) => ({
      value: `open:${open.id}`,
      label: `${product.name} · открытый · ${ml(open.balance)}${lot.owner ? ` · ${lot.owner}` : ""} · ${open.id.slice(0, 6)}`,
    })),
    ...kind("bottle")
      .filter(({ product }) => product.capacity)
      .map(({ lot, product }) => ({
        value: lot.id,
        label: `${product.name} · ${pcs(lot.remaining)} · ${dateLabel(lot.receivedDate)}${lot.owner ? ` · ${lot.owner}` : ""} · ${formatMoney(lot.unitCost)} · ${lot.id.slice(0, 6)}`,
      })),
  ];
  const packOptions = (value: string) =>
    kind(value).map(({ lot, product }) => ({
      value: lot.id,
      label: `${product.name} · ${pcs(lot.remaining)} · ${dateLabel(lot.receivedDate)} · ${formatMoney(lot.unitCost)} · ${lot.id.slice(0, 6)}`,
    }));
  function navigate(shop: string, month = journal.month, page = 1) {
    const query = new URLSearchParams({ tab: mode });
    if (shop) query.set("shop", shop);
    if (mode === "journal") {
      if (month) query.set("month", month);
      if (page > 1) query.set("page", String(page));
    }
    guardNavigation(() => router.push(`/production?${query}`));
  }

  return (
    <Flex vertical gap={16}>
      <Typography.Title level={2} style={{ margin: 0 }}>
        {headings[mode]}
      </Typography.Title>
      {(mode !== "materials" || journal.shops.length > 0) && (
        <Flex gap={12} align="center" wrap>
          <Typography.Text id="production-source-label">Склад материалов</Typography.Text>
          <Select
            aria-labelledby="production-source-label"
            style={{ minWidth: 230 }}
            value={shopId}
            disabled={pending || !journal.shops.length}
            options={[
              ...(mode === "journal" ? [{ label: "Все склады материалов", value: "" }] : []),
              ...shopOptions,
            ]}
            onChange={(shop) => navigate(shop)}
          />
          {mode === "journal" && (
            <Input
              aria-label="Месяц выпусков"
              type="month"
              value={journal.month}
              style={{ width: 180 }}
              onChange={(event) => navigate(shopId, event.target.value)}
            />
          )}
        </Flex>
      )}
      {error && <Alert showIcon type="error" title={error} />}
      {notice && <Alert showIcon type="success" title={notice} />}
      {mode === "journal" ? (
        <Table
          rowKey="id"
          dataSource={journal.documents}
          scroll={{ x: 1050 }}
          locale={{ emptyText: "За выбранный месяц выпусков нет" }}
          pagination={{
            current: journal.documentPage,
            total: journal.documentCount,
            pageSize: 25,
            showSizeChanger: false,
            onChange: (page) => navigate(shopId, journal.month, page),
          }}
          expandable={{
            expandedRowRender: ({ payload }) => <ReleaseDetails quote={payload as Quote} />,
          }}
          columns={[
            { title: "Дата", dataIndex: "date", render: dateLabel },
            { title: "Распив", render: (_, row) => String(row.payload.name) },
            {
              title: "Склад материалов",
              render: (_, row) => journal.shops.find((shop) => shop.id === row.shopId)?.name,
            },
            {
              title: "Магазин назначения",
              render: (_, row) =>
                typeof row.payload.destinationShopName === "string"
                  ? row.payload.destinationShopName
                  : journal.shops.find((shop) => shop.id === row.shopId)?.name,
            },
            {
              title: "Количество",
              align: "right",
              render: (_, row) => pcs(Number(row.payload.quantity)),
            },
            {
              title: "Себестоимость",
              align: "right",
              render: (_, row) => cash(Number(row.payload.total)),
            },
            { title: "Владелец", render: (_, row) => String(row.payload.owner ?? "—") },
            { title: "Примечание", dataIndex: "note", render: (value: string) => value || "—" },
          ]}
        />
      ) : mode === "materials" ? (
        <>
          <Card title="Создать карточку материала">
            <Typography.Paragraph>
              После создания карточки укажите фактическое количество и закупочную цену в{" "}
              <Link href={`/stock/new?mode=receipt${shopId ? `&shop=${shopId}` : ""}`}>
                приёмке
              </Link>
              .
            </Typography.Paragraph>
            <MaterialForm
              pending={pending}
              onChange={() => setDirty(true)}
              save={(values, reset) => {
                setError("");
                setNotice("");
                startTransition(async () => {
                  const result = await createProductionMaterial(values);
                  if (result.ok) {
                    reset();
                    setDirty(false);
                    setNotice("Карточка материала доступна в приёмке");
                  } else setError(result.error);
                });
              }}
            />
          </Card>
          <Card title="Открытые флаконы">
            <Table
              rowKey={({ open }) => open.id}
              dataSource={options.opened}
              size="small"
              scroll={{ x: 650 }}
              locale={{ emptyText: "Открытых флаконов с остатком пока нет" }}
              columns={[
                { title: "Парфюм", render: (_, row) => row.product.name },
                { title: "Партия", render: (_, row) => row.open.id.slice(0, 6) },
                { title: "Владелец", render: (_, row) => row.lot.owner ?? "—" },
                { title: "Остаток", align: "right", render: (_, row) => ml(row.open.balance) },
                {
                  title: "Стоимость остатка",
                  align: "right",
                  render: (_, row) => cash(row.open.cost),
                },
                { title: "Последний расход", render: (_, row) => dateLabel(row.open.date) },
              ]}
            />
          </Card>
        </>
      ) : !shopId ? (
        <Alert
          type="info"
          showIcon
          title="Сначала настройте магазины и проведите приёмку"
          description={<Link href="/stock">Открыть склад</Link>}
        />
      ) : (
        <>
          {(!sourceOptions.length || !kind("atom").length || !kind("label").length) && (
            <Alert
              type="info"
              showIcon
              title="Для выпуска нужны остатки парфюма, атомайзеров и наклеек"
              description={
                <Flex gap={16} wrap>
                  <Link href={`/stock/new?mode=receipt&shop=${shopId}`}>Приёмка товара</Link>
                  <Link href={`/production?tab=materials&shop=${shopId}`}>Карточки материалов</Link>
                </Flex>
              }
            />
          )}
          <Card title="Партии и объём">
            <Form
              form={form}
              layout="vertical"
              disabled={pending}
              initialValues={{
                destinationShopId: shopId,
                volume: 10,
                quantity: 1,
                work: "8",
                workMode: "ml",
                extra: "0",
                outputName: "",
                note: "",
              }}
              onValuesChange={() => {
                setDirty(true);
                setPrepared(undefined);
                setError("");
                setNotice("");
              }}
              onFinish={(input) => {
                setPrepared(undefined);
                setError("");
                setNotice("");
                startTransition(async () => {
                  const result = await previewRelease({ ...input, shopId });
                  if (!result.ok) setError(result.error);
                  else setPrepared({ quote: result.quote, input, key: crypto.randomUUID() });
                });
              }}
            >
              <Form.Item name="source" label="Парфюм со склада" rules={[{ required: true }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder="Закрытый или открытый флакон"
                  options={sourceOptions}
                />
              </Form.Item>
              <Flex gap={16} wrap>
                <Form.Item name="volume" label="Объём одного распива" rules={[{ required: true }]}>
                  <Select
                    options={[2, 3, 5, 10].map((value) => ({ value, label: ml(value * 1000) }))}
                  />
                </Form.Item>
                <Form.Item name="quantity" label="Количество, шт." rules={[{ required: true }]}>
                  <InputNumber min={1} max={100000} precision={0} />
                </Form.Item>
                <Form.Item
                  name="destinationShopId"
                  label="Магазин назначения"
                  rules={[{ required: true }]}
                >
                  <Select style={{ minWidth: 205 }} options={shopOptions} />
                </Form.Item>
              </Flex>
              <Form.Item name="atom" label="Партия атомайзеров" rules={[{ required: true }]}>
                <Select showSearch optionFilterProp="label" options={packOptions("atom")} />
              </Form.Item>
              <Form.Item name="label" label="Партия наклеек" rules={[{ required: true }]}>
                <Select showSearch optionFilterProp="label" options={packOptions("label")} />
              </Form.Item>
              <Flex gap={16} wrap>
                <Form.Item name="work" label="Стоимость работы, ₽" rules={[{ required: true }]}>
                  <Input inputMode="decimal" style={{ width: 155 }} />
                </Form.Item>
                <Form.Item name="workMode" label="Тариф работы">
                  <Select
                    style={{ width: 125 }}
                    options={[
                      { value: "ml", label: "За 1 мл" },
                      { value: "unit", label: "За 1 шт." },
                    ]}
                  />
                </Form.Item>
                <Form.Item
                  name="extra"
                  label="Прочие затраты за 1 шт., ₽"
                  rules={[{ required: true }]}
                >
                  <Input inputMode="decimal" />
                </Form.Item>
              </Flex>
              <Form.Item name="outputName" label="Название при первом выпуске">
                <Input maxLength={240} placeholder="Предложим название из карточки флакона" />
              </Form.Item>
              {mode === "release" && (
                <Form.Item name="note" label="Примечание">
                  <Input maxLength={1000} />
                </Form.Item>
              )}
              <Button type="primary" htmlType="submit" loading={pending}>
                Рассчитать выпуск
              </Button>
            </Form>
          </Card>
          {prepared && (
            <Card title={prepared.quote.name}>
              <Typography.Paragraph>
                Магазин назначения — <strong>{prepared.quote.destinationShopName}</strong>
              </Typography.Paragraph>
              <ReleaseDetails quote={prepared.quote} />
              <Typography.Paragraph>
                {prepared.quote.productId
                  ? "Готовые распивы поступят в существующую карточку."
                  : "При первом выпуске будет создана карточка готового распива."}
              </Typography.Paragraph>
              {mode === "release" && (
                <Button
                  type="primary"
                  loading={pending}
                  onClick={() => {
                    setError("");
                    startTransition(async () => {
                      const result = await postRelease({
                        ...prepared.input,
                        shopId,
                        key: prepared.key,
                        date: prepared.quote.date,
                        fingerprint: prepared.quote.fingerprint,
                      });
                      if (result.ok) {
                        setPrepared(undefined);
                        form.resetFields();
                        setDirty(false);
                        setNotice(
                          `Выпуск проведён. Магазин назначения — ${prepared.quote.destinationShopName}.`,
                        );
                        router.refresh();
                      } else setError(result.error);
                    });
                  }}
                >
                  Провести выпуск
                </Button>
              )}
            </Card>
          )}
        </>
      )}
    </Flex>
  );
}

function ReleaseDetails({ quote }: { quote: Quote }) {
  return (
    <Descriptions
      column={{ xs: 1, sm: 2 }}
      items={[
        { key: "perfume", label: "Парфюм", children: `${quote.perfume} · ${ml(quote.used)}` },
        { key: "perfumeCost", label: "Стоимость парфюма", children: cash(quote.perfumeCost) },
        {
          key: "atom",
          label: "Атомайзер",
          children: `${quote.atom} · ${formatMoney(quote.atomCost)}`,
        },
        {
          key: "label",
          label: "Наклейка",
          children: `${quote.label} · ${formatMoney(quote.labelCost)}`,
        },
        { key: "work", label: "Работа", children: cash(quote.work) },
        { key: "extra", label: "Прочие затраты", children: cash(quote.extra) },
        {
          key: "balance",
          label: "Остаток флакона после выпуска",
          children: ml(quote.balance - quote.used),
        },
        { key: "total", label: "Себестоимость партии", children: cash(quote.total) },
        {
          key: "unit",
          label: "Себестоимость штуки",
          children: quote.output
            .map(
              ({ quantity, unitCost }) =>
                `${formatMoney(unitCost)}${quote.output.length > 1 ? ` × ${pcs(quantity)}` : ""}`,
            )
            .join(" / "),
        },
        { key: "owner", label: "Владелец партии", children: quote.owner ?? "—" },
      ]}
    />
  );
}

function MaterialForm({
  pending,
  onChange,
  save,
}: {
  pending: boolean;
  onChange: () => void;
  save: (input: unknown, reset: () => void) => void;
}) {
  const [form] = Form.useForm();
  const material = Form.useWatch("kind", form) ?? "atom";
  return (
    <Form
      form={form}
      layout="vertical"
      disabled={pending}
      initialValues={{ kind: "atom" }}
      onValuesChange={onChange}
      onFinish={(values) => save(values, () => form.resetFields())}
    >
      <Flex gap={16} wrap align="end">
        <Form.Item name="kind" label="Вид материала">
          <Select
            style={{ width: 150 }}
            options={[
              { value: "atom", label: "Атомайзер" },
              { value: "label", label: "Наклейка" },
            ]}
          />
        </Form.Item>
        <Form.Item name="name" label="Название" rules={[{ required: true, whitespace: true }]}>
          <Input maxLength={160} style={{ width: 220 }} />
        </Form.Item>
        {material === "atom" && (
          <Form.Item name="capacity" label="Вместимость, мл" rules={[{ required: true }]}>
            <InputNumber min={1} max={1000} precision={0} />
          </Form.Item>
        )}
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={pending}>
            Создать карточку
          </Button>
        </Form.Item>
      </Flex>
    </Form>
  );
}
