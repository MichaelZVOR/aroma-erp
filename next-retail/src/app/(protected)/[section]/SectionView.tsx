"use client";

import { Card, Typography } from "antd";

export default function SectionView({ title }: { title: string }) {
  return (
    <Card>
      <Typography.Title level={1}>{title}</Typography.Title>
      <Typography.Paragraph>
        Каркас новой Аромы. Функции раздела переносятся по плану.
      </Typography.Paragraph>
    </Card>
  );
}
