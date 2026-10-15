import type { Metadata } from 'next';
import { PublicObjectViewer } from '@/components/public-object-viewer';
export const metadata: Metadata = {
  title: 'Свойства объекта — maket',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function Page({ params }: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await params;
  return <PublicObjectViewer id={id} token={token} />;
}
