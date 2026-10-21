import type { Metadata } from 'next';
import './globals.css';
import './interface.css';
export const metadata: Metadata = {
  title: 'maket — пространство для идей',
  description: 'Диаграммы и гибкие нотации в одном рабочем пространстве',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
