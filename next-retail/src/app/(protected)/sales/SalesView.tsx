"use client";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import { useNavigationGuard, useNavigationLock } from "../NavigationProtection";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { LedgerFilters, StoreOverview } from "../../../server/store-ledger";
import { formatMoney, multiplyMoney, sumMoney } from "../../../domain/money";
import PriceEditor from "../stock/PriceEditor";
import SectionTiles from "../stock/SectionTiles";
import { PlusOutlined } from "@ant-design/icons";
import { postStoreDocument, readStoreHistory, setupStores } from "./actions";
import DocumentDetails from "./DocumentDetails";
import StockTemplateView from "./StockTemplateView";

const labels: Record<string, string> = {
  sale: "Продажа",
  initial: "Начальные остатки",
  receipt: "Приёмка",
  inventory: "Инвентаризация",
  transfer: "Перемещение",
  writeoff: "Списание",
  expense: "Расход",
  reversal: "Отмена продажи",
  price: "Изменение цены",
};
function documentAmount(payload: Record<string, unknown>) {
  if (typeof payload.cost === "number") return payload.cost;
  if (typeof payload.amount === "number") return payload.amount;
  const totals = payload.totals as { revenue?: number } | undefined;
  if (typeof totals?.revenue === "number") return totals.revenue;
  if (!Array.isArray(payload.rows)) return null;
  return sumMoney(
    payload.rows.map((row: { unitCost?: number; qty?: number }) =>
      typeof row.unitCost === "number" && typeof row.qty === "number"
        ? multiplyMoney(row.unitCost, row.qty)
        : 0,
    ),
  );
}
export default function SalesView({
  data,
  filters,
  workspace = "sales",
}: {
  data: StoreOverview;
  filters: LedgerFilters;
  workspace?: "sales" | "stock";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<StoreOverview["documents"][number] | null>(null);
  const [cancel, setCancel] = useState<StoreOverview["documents"][number] | null>(null);
  const { confirmDiscard } = useNavigationGuard();
  const [reason, setReason] = useState("");
  const [setupDirty, setSetupDirty] = useState(false);
  const cancellationDirty = Boolean(cancel) && !!reason.trim();
  const unlockCancellation = useNavigationLock(cancellationDirty);
  useNavigationLock(setupDirty);
  const closeCancellation = () => {
    unlockCancellation();
    setCancel(null);
  };
  const [history, setHistory] = useState<Awaited<ReturnType<typeof readStoreHistory>>>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [version, setVersion] = useState<number | undefined>();
  const [search, setSearch] = useState(filters.q ?? "");
  const update = (changes: Record<string, string>) => {
    const params = new URLSearchParams({
      shop: filters.shopId ?? "",
      month: data.month,
      tab: filters.tab ?? "overview",
      q: filters.q ?? "",
      age: String(filters.age ?? 0),
      page: String(filters.page ?? 1),
      status: filters.status ?? "",
      ...changes,
    });
    router.push(`/${workspace}?${params}`);
  };
  const newHref = (mode: string) =>
    `/${mode === "receipt" || mode === "inventory" ? "stock" : "sales"}/new?mode=${mode}&shop=${encodeURIComponent(filters.shopId ?? "")}`;
  const exportHref = (format: string) =>
    `/api/export/stock?format=${format}&shop=${encodeURIComponent(filters.shopId ?? "")}`;
  const totals = data.totals;
  const stats = [
    ["Выручка", totals.revenue],
    ["Себестоимость продаж", totals.cost],
    ["Валовая прибыль", totals.gross],
    ["Эквайринг", totals.fee],
    ["Расходы месяца", totals.expenses],
    ["Недостачи", totals.shortage],
    ["После учтённых расходов", totals.result],
    ["Стоимость остатков", totals.stockValue],
  ] as const;
  if (data.shops.length === 0)
    return (
      <Card style={{ maxWidth: 720 }}>
        <Typography.Title level={2}>Продажи и остатки магазинов</Typography.Title>
        <Typography.Paragraph>
          Сначала укажи два магазина. Затем внеси реальное наличие через приёмку. Каталог товаров
          уже может содержать позиции, которых сейчас нет в наличии.
        </Typography.Paragraph>
        {error && <Alert type="error" title={error} />}
        <Form
          layout="vertical"
          onValuesChange={(_, values) => setSetupDirty(!!(values.first || values.second))}
          onFinish={(values: { first: string; second: string }) =>
            start(async () => {
              const result = await setupStores([values.first, values.second]);
              if (!result.ok) setError(result.error);
              else {
                setSetupDirty(false);
                router.refresh();
              }
            })
          }
        >
          <Form.Item label="Первый магазин" name="first" rules={[{ required: true }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item label="Второй магазин" name="second" rules={[{ required: true }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={pending}>
            Создать два магазина
          </Button>
        </Form>
      </Card>
    );
  return (
    <Space orientation="vertical" size={20} style={{ width: "100%" }}>
      {workspace === "sales" && (
        <>
          <div>
            <Typography.Title level={2} style={{ marginBottom: 4 }}>
              Продажи
            </Typography.Title>
            <Typography.Text type="secondary">
              Готовые товары · два магазина · учёт по партиям
            </Typography.Text>
          </div>
          <SectionTiles
            active={filters.tab ?? "overview"}
            shopId={filters.shopId}
            month={data.month}
          />
        </>
      )}
      {error && <Alert closable onClose={() => setError("")} type="error" title={error} />}
      <Space wrap>
        <Select
          aria-label="Магазин"
          value={filters.shopId || ""}
          style={{ width: 240 }}
          options={[
            { value: "", label: "Все магазины" },
            ...data.shops.map((shop) => ({ value: shop.id, label: shop.name })),
          ]}
          onChange={(shop) => update({ shop, page: "1" })}
        />
        {(workspace === "sales" || filters.tab !== "stock") && (
          <Input
            aria-label="Месяц отчёта"
            type="month"
            value={data.month}
            style={{ width: 180 }}
            onChange={(event) => update({ month: event.target.value, page: "1" })}
          />
        )}
        {workspace === "sales" && (
          <>
            <Link href={newHref("sale")}>
              <Button type="primary">Записать продажу</Button>
            </Link>
            <Link href={newHref("expense")}>
              <Button>Записать расход</Button>
            </Link>
          </>
        )}
        {workspace === "stock" && filters.tab === "receipts" && (
          <Link href={newHref("receipt")}>
            <Button type="primary" icon={<PlusOutlined />}>
              Создать приёмку
            </Button>
          </Link>
        )}
        {workspace === "stock" && filters.tab === "inventory" && (
          <Link href={newHref("inventory")}>
            <Button type="primary" icon={<PlusOutlined />}>
              Создать инвентаризацию
            </Button>
          </Link>
        )}
        {filters.tab !== "stock" && filters.tab !== "overview" && (
          <Select
            aria-label="Статус документа"
            value={filters.status ?? ""}
            style={{ width: 180 }}
            options={[
              { value: "", label: "Все статусы" },
              { value: "posted", label: "Проведён" },
              { value: "reversed", label: "Отменён" },
            ]}
            onChange={(status) => update({ status, page: "1" })}
          />
        )}
      </Space>
      {workspace === "stock" && filters.tab === "receipts" && data.documentCount === 0 && (
        <Alert
          type="info"
          showIcon
          title="Начните с фактической приёмки"
          description="Выберите магазин и внесите товар, который реально находится в нём. Для первого заполнения отметьте начальные остатки. Каталог сам по себе наличия не создаёт. После приёмки товар появится во вкладке «Остатки и сроки»."
        />
      )}
      {workspace === "stock" && filters.tab === "inventory" && data.documentCount === 0 && (
        <Alert
          type="info"
          showIcon
          title="Сверьте остаток с фактическим наличием"
          description="После пересчёта выберите партию, укажите фактическое количество и причину расхождения. Программа сохранит корректировку отдельным документом."
        />
      )}
      {filters.tab === "overview" && (
        <>
          {totals.preliminaryLines > 0 && (
            <Alert
              type="warning"
              showIcon
              title="Результат содержит предварительную себестоимость"
              description={`Предварительная стоимость проданного: ${formatMoney(totals.preliminaryCost)}. Уточняйте цены при приёмке.`}
            />
          )}
          <Row gutter={[16, 16]}>
            {stats.map(([title, value]) => (
              <Col key={title} xs={24} md={12} xl={6}>
                <Card>
                  <Statistic
                    title={title}
                    value={formatMoney(value)}
                    styles={{
                      content: {
                        fontSize: 24,
                        color:
                          title === "После учтённых расходов" && value < 0 ? "#cf1322" : undefined,
                      },
                    }}
                  />
                </Card>
              </Col>
            ))}
          </Row>
          <Card title="Расшифровка месяца">
            <Descriptions
              column={{ xs: 1, md: 3 }}
              items={[
                { key: "cash", label: "Наличные", children: formatMoney(totals.cash) },
                { key: "card", label: "Карта", children: formatMoney(totals.card) },
                { key: "discount", label: "Скидки", children: formatMoney(totals.discount) },
                {
                  key: "margin",
                  label: "Валовая маржа",
                  children: totals.margin === null ? "—" : `${totals.margin}%`,
                },
                {
                  key: "markup",
                  label: "Наценка",
                  children: totals.markup === null ? "—" : `${totals.markup}%`,
                },
                {
                  key: "surplus",
                  label: "Излишки отдельно",
                  children: formatMoney(totals.surplus),
                },
              ]}
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
              Результат = валовая прибыль − эквайринг − внесённые расходы − недостачи. Для полной
              картины нужно внести все применимые расходы и налоги. Остатки показывают текущее
              наличие, финансовые показатели — выбранный месяц.
            </Typography.Paragraph>
          </Card>
          <Alert
            type="info"
            title="Что проверить"
            description="Открой «Остатки и сроки» и выбери порог хранения. Проверь старые партии, товары без продаж, истекающие сроки и предварительную стоимость. Скидки назначаются вручную."
          />
        </>
      )}
      {filters.tab === "stock" && (
        <Card
          title="Остатки по партиям"
          extra={
            <Space>
              <a href={exportHref("csv")}>
                <Button>Скачать остатки CSV</Button>
              </a>
              <a href={exportHref("bifit")}>
                <Button disabled={!filters.shopId}>В наличии → БИФИТ CSV</Button>
              </a>
            </Space>
          }
        >
          <Space wrap style={{ marginBottom: 16 }}>
            <Input.Search
              aria-label="Найти товар в остатках"
              placeholder="Название товара"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onSearch={() => update({ q: search, page: "1" })}
              style={{ width: 320 }}
            />
            <Select
              aria-label="Срок без движения"
              value={filters.age ?? 0}
              onChange={(value) => update({ age: String(value), page: "1" })}
              style={{ width: 240 }}
              options={[
                { value: 0, label: "Все сроки" },
                { value: 30, label: "От 30 дней" },
                { value: 60, label: "От 60 дней" },
                { value: 90, label: "От 90 дней" },
              ]}
            />
          </Space>
          <Table
            rowKey="id"
            dataSource={data.stocks}
            scroll={{ x: 1750 }}
            pagination={{
              current: data.stockPage,
              total: data.stockCount,
              pageSize: 25,
              showSizeChanger: false,
              onChange: (page) => update({ page: String(page) }),
            }}
            columns={[
              {
                title: "Товар / магазин",
                key: "name",
                width: 290,
                render: (_, row) => (
                  <>
                    <strong>{row.name}</strong>
                    <div>
                      <Typography.Text type="secondary">{row.shopName}</Typography.Text>
                    </div>
                    <div>
                      <Typography.Text type="secondary">
                        Владелец партии: {row.owner ?? "не указан"}
                      </Typography.Text>
                    </div>
                    {row.preliminary && <Tag color="orange">Стоимость предварительная</Tag>}
                  </>
                ),
              },
              { title: "Остаток, шт.", dataIndex: "remaining" },
              { title: "Себестоимость / шт.", dataIndex: "unitCost", render: formatMoney },
              {
                title: <span style={{ whiteSpace: "nowrap" }}>Цена продажи, ₽</span>,
                key: "salePrice",
                width: 175,
                render: (_, row) => <PriceEditor item={row} />,
              },
              { title: "Стоимость остатка", dataIndex: "value", render: formatMoney },
              { title: "Поступление", dataIndex: "receivedDate" },
              {
                title: "Возраст партии",
                key: "age",
                render: (_, row) =>
                  row.ageDays === null ? "Исходная дата неизвестна" : `${row.ageDays} дн.`,
              },
              {
                title: "Последняя продажа товара",
                key: "last",
                render: (_, row) => (
                  <>
                    {row.lastSale ?? "Продаж ещё нет"}
                    <div>{row.daysWithoutSale} дн. без продаж</div>
                    {row.noSalesThisMonth && <Tag>Нет продаж за месяц</Tag>}
                  </>
                ),
              },
              {
                title: "Годен до",
                key: "expiry",
                render: (_, row) =>
                  row.expired ? (
                    <Tag color="red">{row.expiryDate} · истёк</Tag>
                  ) : (
                    (row.expiryDate ?? "Не указан")
                  ),
              },
            ]}
            locale={{ emptyText: <Empty description="Нет принятого товара по этому фильтру" /> }}
          />
          <StockTemplateView shopId={filters.shopId ?? ""} />
          <Typography.Paragraph type="secondary">
            CSV остатков — по всем партиям выбранного магазина, без ограничения текущей страницей.
            «В наличии → БИФИТ CSV» — только товары с положительным остатком, по одной строке на
            товар, с ценами выбранного магазина и исходными реквизитами, включая GTIN и вид
            маркировки. Это файл товаров и цен; количество для кассы выгружается через её шаблон
            ниже. Закупочная цена в файле товаров остаётся исходной справочной; фактическая
            себестоимость партий есть в отчёте остатков.
          </Typography.Paragraph>
        </Card>
      )}
      {["journal", "receipts", "inventory"].includes(filters.tab ?? "") && (
        <Card
          extra={
            <Input.Search
              aria-label="Поиск документов"
              placeholder="Номер, товар или примечание"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onSearch={() => update({ q: search, page: "1" })}
              style={{ width: 300, maxWidth: "100%" }}
            />
          }
          title={
            filters.tab === "receipts"
              ? "Проведённые приёмки"
              : filters.tab === "inventory"
                ? "Проведённые инвентаризации"
                : "Сохранённые документы"
          }
        >
          <Table
            rowKey="id"
            dataSource={data.documents}
            scroll={{ x: 950 }}
            pagination={{
              current: data.documentPage,
              total: data.documentCount,
              pageSize: 25,
              showSizeChanger: false,
              onChange: (page) => update({ page: String(page) }),
            }}
            columns={[
              { title: "Дата", dataIndex: "date" },
              {
                title: "Номер",
                dataIndex: "id",
                render: (id: string) => (
                  <Typography.Text title={id} copyable={{ text: id }}>
                    {id.slice(0, 8).toUpperCase()}
                  </Typography.Text>
                ),
              },
              { title: "Вид", dataIndex: "kind", render: (kind: string) => labels[kind] ?? kind },
              {
                title: "Магазин",
                dataIndex: "shopId",
                render: (id: string, row) => {
                  const source = data.shops.find((shop) => shop.id === id)?.name;
                  const destination = row.payload.destinationShopName;
                  return typeof destination === "string"
                    ? `${source ?? "—"} → ${destination}`
                    : source;
                },
              },
              {
                title: "Статус",
                dataIndex: "status",
                render: (status: string) => (
                  <Tag color={status === "posted" ? "green" : "default"}>
                    {status === "posted" ? "Проведён" : "Отменён"}
                  </Tag>
                ),
              },
              { title: "Ответственный", dataIndex: "actor" },
              {
                title: workspace === "stock" ? "Сумма по себестоимости" : "Сумма",
                key: "amount",
                render: (_, row) => formatMoney(documentAmount(row.payload)),
              },
              { title: "Версия", dataIndex: "revision" },
              { title: "Примечание", dataIndex: "note" },
              {
                title: "Действия",
                key: "actions",
                render: (_, row) => (
                  <Space wrap>
                    <Button onClick={() => setDetail(row)}>Открыть</Button>
                    <Button
                      onClick={() =>
                        start(async () => {
                          const entries = await readStoreHistory(row.id);
                          setHistory(entries);
                          setVersion(entries[0]?.revision);
                          setHistoryOpen(true);
                        })
                      }
                    >
                      История
                    </Button>
                    {row.kind === "sale" && row.status === "posted" && (
                      <>
                        <Link href={`/sales/${row.id}/edit`}>
                          <Button>Исправить отчёт</Button>
                        </Link>
                        <Button
                          danger
                          onClick={() => {
                            setCancel(row);
                            setReason("");
                          }}
                        >
                          Отменить ошибку
                        </Button>
                      </>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      )}
      <Modal
        title={detail ? `${labels[detail.kind]} · ${detail.date}` : "Документ"}
        open={Boolean(detail)}
        onCancel={() => setDetail(null)}
        footer={<Button onClick={() => setDetail(null)}>Закрыть</Button>}
        width={1000}
      >
        {detail && (
          <>
            <Descriptions
              items={[
                { key: "id", label: "Документ", children: detail.id },
                { key: "actor", label: "Автор", children: detail.actor },
                { key: "note", label: "Примечание", children: detail.note },
              ]}
            />
            <DocumentDetails payload={detail.payload} />
          </>
        )}
      </Modal>
      <Modal
        title="История ежедневного отчёта"
        open={historyOpen}
        onCancel={() => setHistoryOpen(false)}
        footer={<Button onClick={() => setHistoryOpen(false)}>Закрыть</Button>}
        width={1000}
      >
        <Select
          aria-label="Версия отчёта"
          style={{ width: "100%", marginBottom: 20 }}
          value={version}
          onChange={setVersion}
          options={history.map((entry) => ({
            value: entry.revision,
            label: `Версия ${entry.revision} · ${entry.reason} · ${entry.actor}`,
          }))}
        />
        {history.find((entry) => entry.revision === version) && (
          <DocumentDetails
            payload={
              JSON.parse(
                history.find((entry) => entry.revision === version)!.snapshot.payload,
              ) as Record<string, unknown>
            }
          />
        )}
      </Modal>
      <Modal
        title="Отмена ошибочной продажи"
        open={Boolean(cancel)}
        maskClosable={false}
        keyboard={false}
        cancelButtonProps={{ style: { display: "none" } }}
        onCancel={() => !pending && confirmDiscard(cancellationDirty, closeCancellation, true)}
        confirmLoading={pending}
        okText="Отменить и восстановить остаток"
        okButtonProps={{ danger: true, disabled: reason.trim().length < 3 }}
        onOk={() =>
          start(async () => {
            if (!cancel) return;
            const result = await postStoreDocument("reversal", {
              key: `cancel:${cancel.id}`,
              documentId: cancel.id,
              reason,
              date: cancel.date,
            });
            if (!result.ok) setError(result.error);
            else {
              closeCancellation();
              router.refresh();
            }
          })
        }
      >
        <Typography.Paragraph>
          Для исправления ошибочного ввода. Остаток восстановится, если после продажи не было
          зависимых движений. Возврат покупателя оформляется отдельно.
        </Typography.Paragraph>
        <Input.TextArea
          aria-label="Причина отмены"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Причина отмены"
          maxLength={1000}
        />
      </Modal>
    </Space>
  );
}
