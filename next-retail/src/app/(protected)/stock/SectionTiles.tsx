"use client";
import { FileTextOutlined, BarChartOutlined } from "@ant-design/icons";
import { theme } from "antd";
import Link from "next/link";

const salesItems = [
  {
    key: "overview",
    title: "Итог месяца",
    description: "Продажи, прибыль и расходы",
    icon: BarChartOutlined,
  },
  {
    key: "journal",
    title: "Ежедневные отчёты",
    description: "Документы и исправления",
    icon: FileTextOutlined,
  },
];
export default function SectionTiles({
  active,
  shopId = "",
  month = "",
}: {
  active: string;
  shopId?: string;
  month?: string;
}) {
  const { token } = theme.useToken();
  return (
    <nav
      aria-label="Разделы продаж"
      className="section-tiles"
      style={{ gridTemplateColumns: `repeat(${salesItems.length}, minmax(0, 1fr))` }}
    >
      {salesItems.map(({ key, title, description, icon: Icon }) => {
        const selected = active === key;
        const query = new URLSearchParams({
          tab: key,
          ...(shopId ? { shop: shopId } : {}),
          ...(month ? { month } : {}),
        });
        return (
          <Link
            key={key}
            href={`/sales?${query}`}
            aria-current={selected ? "page" : undefined}
            className="section-tile"
            style={{
              background: selected ? token.colorPrimaryBg : token.colorBgContainer,
              color: selected ? token.colorPrimary : token.colorText,
              borderColor: selected ? token.colorPrimary : token.colorBorderSecondary,
            }}
          >
            <Icon style={{ fontSize: 23 }} />
            <span>
              <strong>{title}</strong>
              <small style={{ color: token.colorTextSecondary }}>{description}</small>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
