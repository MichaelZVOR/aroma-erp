"use client";
import { Alert, Button, Input, Modal, Space, Table, Typography } from "antd";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, moneyInput, rubles } from "../../../domain/money";
import { todayMoscow } from "../../../domain/store-sales";
import { useNavigationGuard, useNavigationLock } from "../NavigationProtection";
import { postStoreDocument, readShopPriceHistory } from "../sales/actions";

type Item = {
  shopId: string;
  productId: string;
  name: string;
  shopName: string;
  price: number | null;
  priceRevision: number;
};
export default function PriceEditor({ item }: { item: Item }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { confirmDiscard } = useNavigationGuard();
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const initialPrice = item.price === null ? "" : rubles(item.price);
  const dirty = price !== initialPrice || !!reason.trim();
  const unlockPrice = useNavigationLock(open && dirty);
  const closePrice = () => {
    unlockPrice();
    setOpen(false);
  };
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [history, setHistory] = useState<Awaited<ReturnType<typeof readShopPriceHistory>>>([]);
  const key = useRef<string | null>(null);
  return (
    <>
      <Space direction="vertical" size={2}>
        <strong style={{ whiteSpace: "nowrap" }}>{formatMoney(item.price)}</strong>
        <Button
          size="small"
          onClick={() => {
            setOpen(true);
            setPrice(initialPrice);
            setReason("");
            setError("");
            setHistory([]);
            key.current = null;
            start(async () => {
              try {
                setHistory(await readShopPriceHistory(item.shopId, item.productId));
              } catch {
                setError("Не удалось прочитать историю цен");
              }
            });
          }}
        >
          Изменить цену
        </Button>
      </Space>
      <Modal
        title="Цена продажи в магазине"
        open={open}
        maskClosable={false}
        keyboard={false}
        width={800}
        onCancel={() => {
          if (!pending) confirmDiscard(dirty, closePrice, true);
        }}
        cancelButtonProps={{ style: { display: "none" } }}
        okText="Сохранить цену"
        confirmLoading={pending}
        okButtonProps={{ disabled: !price.trim() || reason.trim().length < 3 }}
        onOk={() =>
          start(async () => {
            setError("");
            try {
              moneyInput(price);
            } catch {
              setError("Введите цену в рублях, не более двух знаков после запятой");
              return;
            }
            key.current ??= crypto.randomUUID();
            try {
              const result = await postStoreDocument("price", {
                key: key.current,
                shopId: item.shopId,
                date: todayMoscow(),
                note: reason,
                reason,
                productId: item.productId,
                price,
                expectedRevision: item.priceRevision,
                expectedPrice: item.price,
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              closePrice();
              router.refresh();
            } catch {
              setError("Не удалось сохранить цену. Повторите попытку");
            }
          })
        }
      >
        <Typography.Paragraph>
          <strong>{item.name}</strong>
          <br />
          {item.shopName}
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          Новая цена применяется ко всем партиям этого товара только в выбранном магазине.
          Себестоимость, каталог и прошлые продажи сохраняются.
        </Typography.Paragraph>
        {error && <Alert type="error" title={error} style={{ marginBottom: 12 }} />}
        <label>
          Новая цена продажи за штуку, ₽
          <Input
            aria-label="Новая цена продажи"
            inputMode="decimal"
            disabled={pending}
            value={price}
            onChange={(event) => {
              setPrice(event.target.value);
              key.current = null;
            }}
            style={{ marginTop: 6, marginBottom: 16 }}
          />
        </label>
        <label>
          Причина изменения
          <Input
            aria-label="Причина изменения цены"
            disabled={pending}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              key.current = null;
            }}
            style={{ marginTop: 6, marginBottom: 20 }}
          />
        </label>
        <Typography.Title level={5}>История цены — последние 100 изменений</Typography.Title>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={history}
          scroll={{ x: 650 }}
          columns={[
            {
              title: "Когда",
              dataIndex: "created",
              render: (value) =>
                new Date(value).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }),
            },
            { title: "Было", dataIndex: "oldPrice", render: formatMoney },
            { title: "Стало", dataIndex: "price", render: formatMoney },
            { title: "Автор", dataIndex: "actor" },
            {
              title: "Основание",
              key: "source",
              render: (_, row) => (row.kind === "price" ? row.note : "Приёмка товара"),
            },
          ]}
          locale={{ emptyText: "Изменений цены пока нет" }}
        />
      </Modal>
    </>
  );
}
