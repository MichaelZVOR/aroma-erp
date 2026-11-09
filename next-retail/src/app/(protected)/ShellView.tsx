"use client";

import { Button, ConfigProvider, Drawer, Layout, Menu } from "antd";
import type { MenuProps } from "antd";
import ruRU from "antd/locale/ru_RU";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  AuditOutlined,
  SwapOutlined,
  MinusCircleOutlined,
  FileTextOutlined,
  HomeOutlined,
  InboxOutlined,
  ShoppingOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  CalculatorOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { legacyRoute } from "../../domain/navigation";
import productCategories from "../../domain/product-categories.json";
import ProductCategoryIcon from "./ProductCategoryIcon";
import { sections, type Section } from "./sections";
import { NavigationProtection, useNavigationGuard } from "./NavigationProtection";

const productItems = productCategories
  .filter(({ key }) => key !== "import")
  .map(({ key, title }) => ({
    key,
    title,
    icon: () => <ProductCategoryIcon category={key} />,
  }));

const stockItems = [
  { key: "receipts", title: "Приёмка", icon: InboxOutlined },
  { key: "stock", title: "Остатки", icon: DatabaseOutlined },
  { key: "transfer", title: "Перемещение", icon: SwapOutlined },
  { key: "writeoff", title: "Списание", icon: MinusCircleOutlined },
  { key: "inventory", title: "Инвентаризация", icon: AuditOutlined },
  { key: "journal", title: "Документы", icon: FileTextOutlined },
];

const productionItems = [
  { key: "release", title: "Выпуск распивов", icon: ExperimentOutlined },
  { key: "quote", title: "Расчёт выпуска", icon: CalculatorOutlined },
  { key: "materials", title: "Материалы и открытые флаконы", icon: InboxOutlined },
  { key: "journal", title: "Журнал выпусков", icon: FileTextOutlined },
];

const panels = {
  products: { label: "Категории товаров", items: productItems },
  stock: { label: "Разделы склада", items: stockItems },
  production: { label: "Разделы производства", items: productionItems },
};

type PanelKey = keyof typeof panels;

function isPanel(key: string): key is PanelKey {
  return Object.hasOwn(panels, key);
}

function link(section: Section) {
  const Icon = {
    overview: HomeOutlined,
    sales: ShoppingOutlined,
    products: DatabaseOutlined,
    stock: DatabaseOutlined,
    production: ExperimentOutlined,
    "production-quote": ExperimentOutlined,
    calculator: CalculatorOutlined,
    competitors: ShoppingOutlined,
    settings: SettingOutlined,
    documents: DatabaseOutlined,
    locations: SettingOutlined,
  }[section];
  return {
    key: section,
    icon: <Icon />,
    label: <Link href={`/${section}`}>{section === "stock" ? "Склад" : sections[section]}</Link>,
  };
}

const items: NonNullable<MenuProps["items"]> = [
  link("overview"),
  link("products"),
  link("stock"),
  link("production"),
  link("calculator"),
  link("competitors"),
  link("sales"),
  link("settings"),
];

export default function ShellView({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={ruRU}
      theme={{
        token: {
          colorPrimary: "#4664dc",
          borderRadius: 8,
          fontFamily: 'Arial, "Segoe UI", sans-serif',
          colorBgLayout: "#f4f6fa",
        },
        components: { Menu: { darkItemBg: "#1e2b40", darkItemSelectedBg: "#4664dc" } },
      }}
    >
      <NavigationProtection>
        <ShellContent>{children}</ShellContent>
      </NavigationProtection>
    </ConfigProvider>
  );
}

function ShellContent({ children }: { children: ReactNode }) {
  const { navigate } = useNavigationGuard();
  const [panel, setPanel] = useState<{ key: PanelKey; open: boolean }>({
    key: "products",
    open: false,
  });
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const section = pathname.split("/")[1];
  const [menuSelection, setMenuSelection] = useState({ pathname, key: section });
  if (menuSelection.pathname !== pathname) {
    setMenuSelection({ pathname, key: section });
    if (panel.open) setPanel({ ...panel, open: false });
  }
  const router = useRouter();
  useEffect(() => {
    const route = legacyRoute(window.location.hash.slice(1));
    if (route) router.replace(route);
  }, [router]);

  const { label: panelLabel, items: panelItems } = panels[panel.key];

  function closePanel() {
    setPanel((current) => ({ ...current, open: false }));
  }

  function openPanelRoute(href: string) {
    if (new URL(href, location.href).href === location.href) {
      closePanel();
      return;
    }
    navigate(() => {
      closePanel();
      router.push(href);
    });
  }

  function choosePanelItem(key: string) {
    if (panel.key === "production") {
      const query = new URLSearchParams({ tab: key });
      if (section === "production") {
        const shop = new URLSearchParams(window.location.search).get("shop");
        if (shop) query.set("shop", shop);
      }
      openPanelRoute(`/production?${query}`);
      return;
    }
    if (panel.key === "stock") {
      const filters = new URLSearchParams(section === "stock" ? window.location.search : "");
      const mode =
        key === "receipts"
          ? "receipt"
          : ["inventory", "transfer", "writeoff"].includes(key)
            ? key
            : null;
      const query = new URLSearchParams(mode ? { mode } : { tab: key });
      for (const filter of ["shop", "month"]) {
        const value = filters.get(filter);
        if (value) query.set(filter, value);
      }
      openPanelRoute(`/stock${mode ? "/new" : ""}?${query}`);
      return;
    }
    openPanelRoute(key === "import" ? "/products?legacy=import" : `/products?category=${key}`);
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Sider
        className="app-shell-sidebar"
        theme="dark"
        width={240}
        breakpoint="lg"
        collapsedWidth={0}
        collapsed={collapsed}
        onCollapse={setCollapsed}
      >
        <div className="app-shell-brand">
          арома.<small>УЧЁТ И ПРОИЗВОДСТВО</small>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          items={items.map((item) =>
            item && "key" in item && typeof item.key === "string" && isPanel(item.key)
              ? {
                  ...item,
                  label: (
                    <Link
                      href={`/${item.key}`}
                      aria-expanded={panel.open && panel.key === item.key}
                      onClick={(event) => event.preventDefault()}
                    >
                      {item.key === "stock" ? "Склад" : sections[item.key]}
                    </Link>
                  ),
                }
              : item,
          )}
          selectedKeys={[menuSelection.key]}
          onClick={({ key }) => {
            setMenuSelection({ pathname, key });
            if (isPanel(key)) {
              setPanel((current) => ({ key, open: !current.open || current.key !== key }));
            } else {
              closePanel();
            }
          }}
        />
        <div className="app-shell-note">
          Только на этом компьютере
          <br />
          Арома ERP
        </div>
      </Layout.Sider>
      <Drawer
        closable={false}
        aria-label={panelLabel}
        placement="left"
        size={280}
        open={panel.open}
        onClose={closePanel}
        rootStyle={{ left: collapsed ? 0 : 240, top: 72, overflow: "hidden" }}
        styles={{ body: { padding: 16 } }}
      >
        <nav aria-label={panelLabel} className="section-panel-menu">
          {panelItems.map(({ key, title, icon: Icon }) => (
            <Button
              key={key}
              type="text"
              block
              icon={<Icon aria-hidden="true" />}
              onClick={() => choosePanelItem(key)}
            >
              {title}
            </Button>
          ))}
        </nav>
      </Drawer>
      <Layout style={{ marginLeft: collapsed ? 0 : 240 }}>
        <Layout.Header className="app-shell-header">
          <div>
            <strong>МОЯ МАСТЕРСКАЯ</strong>
            <small>Локальный учёт</small>
          </div>
        </Layout.Header>
        <Layout.Content style={{ padding: 24 }}>{children}</Layout.Content>
      </Layout>
    </Layout>
  );
}
