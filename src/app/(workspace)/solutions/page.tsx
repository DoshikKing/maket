import { SolutionsPage } from '@/components/solutions';
import { EditorPage } from '@/components/editor';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ diagram?: string }>;
}) {
  const { diagram } = await searchParams;
  if (diagram) return <EditorPage key={diagram} id={diagram} />;
  return <SolutionsPage />;
}
