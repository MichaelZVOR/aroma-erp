"use client";
import { Alert, Button, Card, Input, Typography } from "antd";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
function LoginForm() {
  const params = useSearchParams();
  return (
    <main
      style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f3f5f9" }}
    >
      <Card style={{ width: 380 }}>
        <Typography.Title level={2}>арома.</Typography.Title>
        <Typography.Paragraph>Локальная проверка нового учёта</Typography.Paragraph>
        {params.has("error") && (
          <Alert
            type="error"
            title="Не удалось войти. Проверьте данные или повторите позже."
            style={{ marginBottom: 16 }}
          />
        )}
        <form action="/api/auth/login" method="post" style={{ display: "grid", gap: 16 }}>
          <label>
            Логин
            <Input name="username" autoComplete="username" required />
          </label>
          <label>
            Пароль
            <Input.Password name="password" autoComplete="current-password" required />
          </label>
          <Button type="primary" htmlType="submit">
            Войти
          </Button>
        </form>
        <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
          Данные входа — в файле «data/Локальный вход.txt» папки нового проекта.
        </Typography.Paragraph>
      </Card>
    </main>
  );
}
export default function LoginView() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
