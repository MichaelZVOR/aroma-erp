"use client";
import {
  Alert,
  Breadcrumb,
  Button,
  Image,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Typography,
  theme,
} from "antd";
import { FolderOutlined, ArrowUpOutlined, PlusOutlined, MinusOutlined } from "@ant-design/icons";
import { useRef, useState } from "react";
import { useNavigationGuard, useNavigationLock } from "../NavigationProtection";
import { browseStoreCatalogue } from "../sales/actions";
import productCategories from "../../../domain/product-categories.json";
import { rubles } from "../../../domain/money";
import { stockOwnerOptions, type StockOwner } from "../../../domain/stock-owners";

type Catalogue = Awaited<ReturnType<typeof browseStoreCatalogue>>;
export type PickedProduct = Catalogue["rows"][number] & {
  qty: number;
  unitCost?: string;
  salePriceInput?: string;
  owner?: StockOwner | null;
};
const fallbackNames: Record<string, string> = {
  bottle: "Полноразмерные флаконы",
  decant: "Распив",
  atom: "Атомайзеры",
  label: "Наклейки",
  other: "Прочие товары",
};
export default function ProductPicker({
  disabled,
  shopId,
  remainingLines,
  onAdd,
}: {
  disabled: boolean;
  shopId: string;
  remainingLines: number;
  onAdd: (rows: PickedProduct[]) => void;
}) {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Record<string, PickedProduct>>({});
  const [drafts, setDrafts] = useState<
    Record<string, { unitCost: string; salePriceInput: string; owner: StockOwner | null }>
  >({});
  const inputs = (row: Catalogue["rows"][number]) =>
    drafts[row.product.id] ?? {
      owner: null,
      unitCost: row.suggestedCost === null ? "" : rubles(row.suggestedCost),
      salePriceInput: row.salePrice === null ? "" : rubles(row.salePrice),
    };
  const version = useRef(0);
  async function load(text: string, group: string, page = 1) {
    const request = ++version.current;
    setLoading(true);
    setError("");
    try {
      const result = await browseStoreCatalogue(text, group, page, shopId);
      if (request === version.current) setCatalogue(result);
    } catch {
      if (request === version.current) setError("Не удалось загрузить товары. Повторите поиск.");
    } finally {
      if (request === version.current) setLoading(false);
    }
  }
  function chooseGroup(group: string) {
    setCategory(group);
    setQuery("");
    void load("", group);
  }
  const directory = !category && !query.trim();
  const count = Object.keys(selected).length;
  const { confirmDiscard } = useNavigationGuard();
  const dirty = count > 0 || Object.keys(drafts).length > 0;
  const unlockPicker = useNavigationLock(open && dirty);
  const closePicker = () => {
    unlockPicker();
    version.current++;
    setOpen(false);
  };
  const counts = new Map(catalogue?.categories.map(({ name, count }) => [name, count]));
  const directoryRows = productCategories
    .filter(({ kind }) => kind)
    .map(({ title }) => ({
      name: title,
      count: counts.get(title) ?? 0,
    }));
  const known = new Set(directoryRows.map(({ name }) => name));
  directoryRows.push(...(catalogue?.categories ?? []).filter(({ name }) => !known.has(name)));

  return (
    <>
      <Button
        type="primary"
        icon={<PlusOutlined />}
        disabled={disabled}
        onClick={() => {
          setSelected({});
          setDrafts({});
          setCategory("");
          setQuery("");
          setCatalogue(null);
          setOpen(true);
          void load("", "");
        }}
      >
        Добавить товар
      </Button>
      <Modal
        title="Добавление товаров в приёмку"
        open={open}
        maskClosable={false}
        keyboard={false}
        width="min(1600px, calc(100vw - 32px))"
        style={{ top: 12 }}
        styles={{ body: { height: "calc(100dvh - 175px)", minHeight: 300, overflow: "auto" } }}
        onCancel={() => confirmDiscard(dirty, closePicker, true)}
        footer={
          <Space>
            <Typography.Text type="secondary">Выбрано позиций: {count}</Typography.Text>
            <Button
              type="primary"
              disabled={!count || count > remainingLines}
              onClick={() => {
                onAdd(Object.values(selected).map((row) => ({ ...row, ...inputs(row) })));
                closePicker();
              }}
            >
              Добавить в документ
            </Button>
          </Space>
        }
      >
        <Input.Search
          aria-label="Поиск по всем товарам"
          placeholder="Поиск по всем товарам"
          value={query}
          allowClear
          onChange={(event) => {
            setQuery(event.target.value);
            void load(event.target.value, category);
          }}
          onSearch={(text) => void load(text, category)}
          style={{ marginBottom: 16 }}
        />
        <Breadcrumb
          style={{ marginBottom: 16 }}
          items={[
            {
              title: (
                <Button
                  type="link"
                  style={{
                    padding: 0,
                    height: "auto",
                    border: 0,
                    fontSize: "inherit",
                    lineHeight: "inherit",
                    verticalAlign: "baseline",
                  }}
                  onClick={() => chooseGroup("")}
                >
                  Все категории
                </Button>
              ),
            },
            ...(category ? [{ title: fallbackNames[category] ?? category }] : []),
          ]}
        />
        {error && <Alert type="error" title={error} style={{ marginBottom: 12 }} />}
        {count > remainingLines && (
          <Alert
            type="warning"
            title={`В документ можно добавить ещё ${remainingLines} позиций`}
            style={{ marginBottom: 12 }}
          />
        )}
        {directory ? (
          <Table
            rowKey="name"
            loading={loading}
            pagination={false}
            dataSource={directoryRows}
            onRow={(row) => ({
              tabIndex: 0,
              style: { cursor: "pointer" },
              "aria-label": `Открыть категорию ${fallbackNames[row.name] ?? row.name}`,
              onClick: () => chooseGroup(row.name),
              onKeyDown: (event) => {
                if (
                  event.target === event.currentTarget &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault();
                  chooseGroup(row.name);
                }
              },
            })}
            columns={[
              {
                title: "Категория товара",
                key: "name",
                render: (_, row) => (
                  <Button
                    type="link"
                    icon={<FolderOutlined />}
                    onClick={(event) => {
                      event.stopPropagation();
                      chooseGroup(row.name);
                    }}
                  >
                    {fallbackNames[row.name] ?? row.name}
                  </Button>
                ),
              },
              { title: "Товаров", dataIndex: "count", width: 120 },
            ]}
          />
        ) : (
          <>
            {category && (
              <Button
                type="text"
                icon={<ArrowUpOutlined />}
                onClick={() => chooseGroup("")}
                style={{ marginBottom: 8 }}
              >
                К категориям
              </Button>
            )}
            <Table
              className="picker-products-table"
              rowKey={(row) => row.product.id}
              loading={loading}
              dataSource={catalogue?.rows ?? []}
              scroll={{ x: 1185, y: "calc(100dvh - 330px)" }}
              pagination={{
                current: catalogue?.page ?? 1,
                total: catalogue?.total ?? 0,
                pageSize: 25,
                showSizeChanger: false,
                onChange: (page) => void load(query, category, page),
              }}
              columns={[
                {
                  title: "",
                  key: "photo",
                  width: 64,
                  render: (_, row) =>
                    row.image ? (
                      <Image
                        src={row.image}
                        alt={row.product.name}
                        width={38}
                        height={46}
                        style={{ objectFit: "contain" }}
                        preview={false}
                      />
                    ) : (
                      <FolderOutlined style={{ color: "#b5bfce", fontSize: 24 }} />
                    ),
                },
                {
                  title: "Наименование",
                  key: "name",
                  width: 220,
                  render: (_, row) => row.product.name.replace(/(\d) мл$/u, "$1\u00a0мл"),
                },
                {
                  title: "Владелец",
                  key: "owner",
                  width: 130,
                  render: (_, row) => (
                    <Select<StockOwner>
                      aria-label={`Владелец ${row.product.name}`}
                      allowClear
                      placeholder="—"
                      value={inputs(row).owner ?? undefined}
                      options={stockOwnerOptions}
                      style={{ width: "100%" }}
                      onChange={(owner) =>
                        setDrafts((current) => ({
                          ...current,
                          [row.product.id]: { ...inputs(row), owner: owner ?? null },
                        }))
                      }
                    />
                  ),
                },
                { title: "Штрихкод", dataIndex: "barcode", width: 110 },
                { title: "Артикул", dataIndex: "vendorCode", width: 90 },
                ...(
                  [
                    ["unitCost", "Себестоимость / шт., ₽"],
                    ["salePriceInput", "Цена продажи / шт., ₽"],
                  ] as const
                ).map(([field, label]) => ({
                  title: <span style={{ whiteSpace: "nowrap" }}>{label}</span>,
                  key: field,
                  width: 190,
                  render: (_: unknown, row: Catalogue["rows"][number]) => (
                    <Input
                      aria-label={`${field === "unitCost" ? "Себестоимость" : "Цена продажи"} ${row.product.name}`}
                      value={inputs(row)[field]}
                      inputMode="decimal"
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [row.product.id]: { ...inputs(row), [field]: event.target.value },
                        }))
                      }
                    />
                  ),
                })),
                {
                  title: "Кол-во, шт.",
                  key: "qty",
                  align: "center",
                  width: 190,
                  onCell: () => ({ style: { paddingInline: 8 } }),
                  render: (_, row) => (
                    <div
                      className="picker-quantity"
                      role="group"
                      aria-label={`Количество ${row.product.name}`}
                      style={{ borderColor: token.colorBorder }}
                    >
                      <Button
                        type="text"
                        icon={<MinusOutlined />}
                        aria-label={`Уменьшить количество ${row.product.name}`}
                        disabled={!selected[row.product.id]?.qty}
                        onClick={() =>
                          setSelected((current) => {
                            const next = { ...current };
                            const qty = Math.max(0, (current[row.product.id]?.qty ?? 0) - 1);
                            if (!qty) delete next[row.product.id];
                            else next[row.product.id] = { ...row, qty };
                            return next;
                          })
                        }
                      />
                      <InputNumber
                        aria-label={`Количество ${row.product.name}`}
                        min={0}
                        max={100000}
                        precision={0}
                        controls={false}
                        variant="borderless"
                        styles={{
                          root: { paddingInline: 0, height: 38 },
                          input: {
                            textAlign: "center",
                            padding: 0,
                            height: 38,
                            lineHeight: "38px",
                            fontVariantNumeric: "tabular-nums",
                          },
                        }}
                        value={selected[row.product.id]?.qty ?? 0}
                        onChange={(value) =>
                          setSelected((current) => {
                            const next = { ...current };
                            if (!value) delete next[row.product.id];
                            else next[row.product.id] = { ...row, qty: value };
                            return next;
                          })
                        }
                      />
                      <Button
                        type="text"
                        icon={<PlusOutlined />}
                        aria-label={`Увеличить количество ${row.product.name}`}
                        disabled={(selected[row.product.id]?.qty ?? 0) >= 100000}
                        onClick={() =>
                          setSelected((current) => ({
                            ...current,
                            [row.product.id]: {
                              ...row,
                              qty: Math.min(100000, (current[row.product.id]?.qty ?? 0) + 1),
                            },
                          }))
                        }
                      />
                    </div>
                  ),
                },
              ]}
            />
          </>
        )}
      </Modal>
    </>
  );
}
