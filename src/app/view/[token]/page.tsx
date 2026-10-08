import type { Metadata } from 'next';
import { PublicViewer } from '@/components/public-viewer';
export const metadata: Metadata = {
  title: 'Просмотр диаграммы — maket',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicViewer token={token} />;
}
