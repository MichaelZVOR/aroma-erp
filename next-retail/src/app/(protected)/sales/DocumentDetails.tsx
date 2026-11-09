"use client";
import { Descriptions, Table, Typography } from "antd";
import { formatMoney } from "../../../domain/money";
export default function DocumentDetails({ payload }: { payload: Record<string, unknown> }) {
  const rows = Array.isArray(payload.rows) ? (payload.rows as Record<string, unknown>[]) : [];
  const totals = payload.totals as Record<string, number | string | null> | undefined;
  const cash = (value: unknown) => (typeof value === "number" ? formatMoney(value) : "—");
  const text = (value: unknown) =>
    typeof value === "string" || typeof value === "number" ? String(value) : "—";
  return (
    <>
      {(typeof payload.destinationShopName === "string" ||
        (typeof payload.reason === "string" &&
          rows.length > 0 &&
          typeof payload.cost === "number")) && (
        <Descriptions
          items={[
            typeof payload.destinationShopName === "string"
              ? {
                  key: "destination",
                  label: "Магазин назначения",
                  children: payload.destinationShopName,
                }
              : { key: "reason", label: "Причина списания", children: text(payload.reason) },
            { key: "cost", label: "Сумма по себестоимости", children: cash(payload.cost) },
          ]}
        />
      )}
      {rows.length > 0 && (
        <Table
          rowKey={(_, index) => String(index)}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 850 }}
          columns={[
            {
              title: "Товар",
              dataIndex: "name",
              width: 260,
              render: (name: unknown, row) => (
                <>
                  {text(name)}
                  {typeof row.owner === "string" && (
                    <div>
                      <Typography.Text type="secondary">
                        Владелец партии: {row.owner}
                      </Typography.Text>
                    </div>
                  )}
                </>
              ),
            },
            { title: "Количество", dataIndex: "qty" },
            { title: "Себестоимость / шт.", dataIndex: "unitCost", render: cash },
            { title: "Цена / шт.", dataIndex: "price", render: cash },
            { title: "Прежняя цена", dataIndex: "oldPrice", render: cash },
            { title: "Выручка", dataIndex: "revenue", render: cash },
            {
              title: "Оплата",
              dataIndex: "payment",
              render: (value: unknown) =>
                value === "cash" ? "Наличные" : value === "card" ? "Карта" : "—",
            },
            { title: "Эквайринг", dataIndex: "fee", render: cash },
          ]}
        />
      )}
      {totals && (
        <Descriptions
          style={{ marginTop: 20 }}
          column={2}
          items={[
            { key: "revenue", label: "Выручка", children: cash(totals.revenue) },
            { key: "cost", label: "Себестоимость", children: cash(totals.cost) },
            { key: "gross", label: "Валовая прибыль", children: cash(totals.gross) },
            { key: "fee", label: "Эквайринг", children: cash(totals.fee) },
            { key: "afterFee", label: "После эквайринга", children: cash(totals.afterFee) },
            { key: "discount", label: "Скидка", children: cash(totals.discount) },
            {
              key: "margin",
              label: "Валовая маржа",
              children: totals.margin === null ? "—" : `${totals.margin}%`,
            },
          ]}
        />
      )}
      {payload.category !== undefined && (
        <Descriptions
          items={[
            { key: "category", label: "Статья", children: text(payload.category) },
            { key: "amount", label: "Расход", children: cash(payload.amount) },
          ]}
        />
      )}
      {payload.actual !== undefined && (
        <Descriptions
          column={2}
          items={[
            { key: "name", label: "Товар", children: text(payload.name) },
            { key: "expected", label: "По учёту", children: text(payload.expected) },
            { key: "actual", label: "Фактически", children: text(payload.actual) },
            { key: "difference", label: "Разница, шт.", children: text(payload.difference) },
            { key: "cost", label: "Стоимость расхождения", children: cash(payload.cost) },
            { key: "reason", label: "Причина", children: text(payload.reason) },
          ]}
        />
      )}
      {payload.originalId !== undefined && (
        <Typography.Paragraph>
          Отмена документа {text(payload.originalId)}. Причина — {text(payload.reason)}
        </Typography.Paragraph>
      )}
    </>
  );
}
