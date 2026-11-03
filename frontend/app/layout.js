import { AntdRegistry } from '@ant-design/nextjs-registry';
import './globals.css';
export const metadata = { title: 'Арома — учёт и производство', description: 'Локальная система учёта парфюмерии', icons: { icon: '/aroma-icon.svg' } };
export default function RootLayout({ children }) {
  return <html lang="ru"><body><AntdRegistry>{children}</AntdRegistry></body></html>;
}
