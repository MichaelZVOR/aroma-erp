"use client";
import { Alert, Button, Card, Input, Select, Space, Typography } from "antd";
import { useState } from "react";
import { readCsv } from "../../../domain/stock-csv";
export default function StockTemplateView({ shopId }: { shopId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [encoding, setEncoding] = useState("utf-8");
  const [separator, setSeparator] = useState(";");
  const [headers, setHeaders] = useState<string[]>([]);
  const [identifierColumn, setIdentifierColumn] = useState("");
  const [quantityColumn, setQuantityColumn] = useState("");
  const [identifierType, setIdentifierType] = useState("bifit");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function inspect() {
    if (!file) {
      setError("Выбери CSV-шаблон остатков");
      return;
    }
    try {
      const text = new TextDecoder(encoding, { fatal: true }).decode(await file.arrayBuffer());
      setHeaders(readCsv(text, separator)[0]);
      setIdentifierColumn("");
      setQuantityColumn("");
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось прочитать CSV");
    }
  }
  async function download() {
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const form = new FormData();
      form.set("template", file);
      form.set("shop", shopId);
      form.set("encoding", encoding);
      form.set("separator", separator);
      form.set("identifierColumn", identifierColumn);
      form.set("quantityColumn", quantityColumn);
      form.set("identifierType", identifierType);
      const response = await fetch("/api/export/stock", { method: "POST", body: form });
      if (!response.ok) throw new Error(await response.text());
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "bifit-stock.csv";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Ошибка выгрузки");
    } finally {
      setLoading(false);
    }
  }
  return (
    <Card size="small" title="Остатки для БИФИТ по его шаблону" style={{ marginTop: 20 }}>
      <Typography.Paragraph>
        В БИФИТ выгрузи отчёт «Остатки по торговым объектам» нужного магазина. Выбери его CSV здесь,
        укажи колонку идентификатора и колонку количества. Программа заменит количества только у
        товаров, которые уже принимались в наш магазин, включая проданные до нуля. Остальные строки
        и реквизиты сохранятся.
      </Typography.Paragraph>
      {error && <Alert type="error" title={error} style={{ marginBottom: 12 }} />}
      <Space wrap style={{ marginBottom: 12 }}>
        <Input
          aria-label="CSV-шаблон остатков БИФИТ"
          type="file"
          accept=".csv,text/csv"
          style={{ width: 300 }}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setHeaders([]);
          }}
        />
        <Select
          aria-label="Кодировка шаблона"
          value={encoding}
          onChange={(value) => {
            setEncoding(value);
            setHeaders([]);
          }}
          options={[
            { value: "utf-8", label: "UTF-8" },
            { value: "windows-1251", label: "Windows-1251" },
          ]}
        />
        <Select
          aria-label="Разделитель CSV"
          value={separator}
          onChange={(value) => {
            setSeparator(value);
            setHeaders([]);
          }}
          options={[
            { value: ";", label: "Точка с запятой" },
            { value: ",", label: "Запятая" },
            { value: "\t", label: "Табуляция" },
          ]}
        />
        <Button onClick={inspect}>Прочитать колонки</Button>
      </Space>
      {headers.length > 0 && (
        <Space wrap>
          <Select
            aria-label="Колонка идентификатора"
            placeholder="Колонка идентификатора"
            value={identifierColumn || undefined}
            onChange={setIdentifierColumn}
            style={{ width: 220 }}
            options={headers.map((value) => ({ value, label: value }))}
          />
          <Select
            aria-label="Тип идентификатора"
            value={identifierType}
            onChange={setIdentifierType}
            style={{ width: 220 }}
            options={[
              { value: "bifit", label: "Внутренний ID БИФИТ" },
              { value: "code", label: "Внешний код товара" },
            ]}
          />
          <Select
            aria-label="Колонка количества"
            placeholder="Колонка количества"
            value={quantityColumn || undefined}
            onChange={setQuantityColumn}
            style={{ width: 220 }}
            options={headers.map((value) => ({ value, label: value }))}
          />
          <Button
            type="primary"
            loading={loading}
            disabled={
              !shopId || !identifierColumn || !quantityColumn || identifierColumn === quantityColumn
            }
            onClick={download}
          >
            Скачать заполненный CSV
          </Button>
        </Space>
      )}
      {!shopId && (
        <Typography.Paragraph type="secondary">
          Для выгрузки в кассу выбери один магазин вверху страницы.
        </Typography.Paragraph>
      )}
    </Card>
  );
}
