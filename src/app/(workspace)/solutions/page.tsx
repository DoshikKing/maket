import { SolutionsPage } from '@/components/solutions';
import { SolutionGraphPage } from '@/components/solution-graph';
import { EditorPage } from '@/components/editor';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ diagram?: string; graph?: string; object?: string }>;
}) {
  const { diagram, graph, object } = await searchParams;
  if (graph) return <SolutionGraphPage key={graph} solutionId={graph} objectId={object} />;
  if (diagram) return <EditorPage key={diagram} id={diagram} />;
  return <SolutionsPage />;
}
