import { ViewpointLayersPage } from '@/components/viewpoint-layers';
import { SolutionsPage } from '@/components/solutions';
import { SolutionGraphPage } from '@/components/solution-graph';
import { EditorPage } from '@/components/editor';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    diagram?: string;
    graph?: string;
    object?: string;
    layers?: string;
    focus?: string;
    view?: string;
  }>;
}) {
  const { diagram, graph, object, layers, focus, view } = await searchParams;
  if (layers) return <ViewpointLayersPage diagramId={focus} />;
  if (graph) return <SolutionGraphPage key={graph} solutionId={graph} objectId={object} />;
  if (diagram) return <EditorPage key={diagram} id={diagram} />;
  return <SolutionsPage view={view === 'diagrams' ? 'diagrams' : 'model'} />;
}
