'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Box,
  FileText,
  Folder,
  GitBranch,
  Network,
  Workflow,
  RefreshCw,
  LocateFixed,
} from 'lucide-react';
import { api } from '@/lib/client';
import { entityLabels, type Space } from '@/lib/model';
import {
  solutionGraph,
  graphPositions,
  graphNeighborhood,
  type SolutionGraph,
} from '@/lib/solution-graph';

type GraphNode = Node<{ item: SolutionGraph['items'][number]; dim: boolean }, 'entity'>;
const icons = {
  solution: Network,
  project: Workflow,
  folder: Folder,
  diagram: FileText,
  object: Box,
  relation: GitBranch,
};
function EntityNode({ data, selected }: NodeProps<GraphNode>) {
  const { entity, relation, external } = data.item,
    kind = relation ? 'relation' : (entity.kind ?? 'object'),
    Icon = icons[kind];
  return (
    <div
      className={`solution-graph-node ${relation ? 'is-relation' : ''} ${selected ? 'is-selected' : ''} ${data.dim ? 'is-dim' : ''}`}
      data-graph-entity={entity.id}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div>
        <Icon size={17} />
        <strong>{entity.name}</strong>
      </div>
      <small>
        {entityLabels[kind]}
        {relation?.relationType ? ` · ${relation.relationType}` : ''}
        {entity.archived ? ' · В архиве' : ''}
      </small>
      {external && <small className="solution-graph-boundary">Вне решения</small>}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
const nodeTypes = { entity: EntityNode };
export function SolutionGraphPage({
  solutionId,
  objectId,
}: {
  solutionId: string;
  objectId?: string;
}) {
  const [space, setSpace] = useState<Space | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    try {
      setSpace(await api<Space>('model'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить граф');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const graph = useMemo(
    () => (space ? solutionGraph(space, solutionId) : null),
    [space, solutionId],
  );
  return (
    <main className="page solution-graph-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">РАБОЧАЯ ОБЛАСТЬ</div>
          <h1>Граф связей</h1>
          <p className="muted">Объекты решения и их связи, независимо от диаграмм и нотаций.</p>
        </div>
        <div className="button-row">
          <Link
            className="secondary"
            href={`/solutions${solutionId === 'all' ? '' : `?parent=${encodeURIComponent(solutionId)}`}`}
          >
            К дереву решений
          </Link>
          <button className="secondary" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={16} />
            Обновить
          </button>
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {!space ? (
        <p className="muted">
          {loading ? 'Загружаем модель…' : 'Граф недоступен. Повторите загрузку.'}
        </p>
      ) : !graph ? (
        <p role="alert">Решение не найдено или недоступно.</p>
      ) : (
        <ReactFlowProvider>
          <Graph
            key={solutionId}
            graph={graph}
            space={space}
            scope={solutionId}
            initialSelection={objectId}
          />
        </ReactFlowProvider>
      )}
    </main>
  );
}
function Graph({
  graph,
  space,
  scope,
  initialSelection,
}: {
  graph: SolutionGraph;
  space: Space;
  scope: string;
  initialSelection?: string;
}) {
  const router = useRouter(),
    flow = useReactFlow<GraphNode>();
  const [nodes, setNodes, onNodesChange] = useNodesState<GraphNode>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelection ?? null),
    [query, setQuery] = useState(''),
    [hierarchy, setHierarchy] = useState(false),
    [local, setLocal] = useState(false),
    [type, setType] = useState('');
  useEffect(() => {
    const positions = graphPositions(graph);
    setNodes((previous) => {
      const old = new Map(previous.map((n) => [n.id, n.position]));
      return graph.items.map((item) => ({
        id: item.entity.id,
        type: 'entity',
        position: old.get(item.entity.id) ?? positions.get(item.entity.id)!,
        data: { item, dim: false },
      }));
    });
    setSelectedId((id) => (id && graph.items.some((i) => i.entity.id === id) ? id : null));
  }, [graph, setNodes]);
  const neighbors = useMemo(
    () => (selectedId ? graphNeighborhood(graph, selectedId) : null),
    [graph, selectedId],
  );
  const matches = useMemo(
    () =>
      new Set(
        graph.items
          .filter((i) =>
            `${i.entity.name} ${entityLabels[i.relation ? 'relation' : (i.entity.kind ?? 'object')]} ${i.relation?.relationType ?? ''}`
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase()),
          )
          .map((i) => i.entity.id),
      ),
    [graph, query],
  );
  const visible = new Set(
    graph.items
      .filter((i) => !local || !neighbors || neighbors.has(i.entity.id))
      .map((i) => i.entity.id),
  );
  const displayNodes = nodes.map((n) => ({
    ...n,
    selected: n.id === selectedId,
    hidden: !visible.has(n.id),
    data: {
      ...n.data,
      dim:
        !matches.has(n.id) ||
        (!!neighbors && !neighbors.has(n.id)) ||
        (!!type && !!n.data.item.relation && n.data.item.relation.relationType !== type),
    },
  }));
  const itemsById = useMemo(() => new Map(graph.items.map((i) => [i.entity.id, i])), [graph]);
  const edges = [...graph.edges, ...(hierarchy ? graph.hierarchy : [])].map((e) => {
    const semantic = 'relationId' in e,
      relationId = 'relationId' in e && typeof e.relationId === 'string' ? e.relationId : undefined;
    const dim =
      (!!neighbors && (!neighbors.has(e.source) || !neighbors.has(e.target))) ||
      (!!type && !!relationId && itemsById.get(relationId)?.relation?.relationType !== type);
    return {
      ...e,
      type: 'smoothstep',
      hidden: !visible.has(e.source) || !visible.has(e.target),
      markerEnd: semantic ? { type: MarkerType.ArrowClosed, color: 'var(--accent)' } : undefined,
      style: {
        stroke: semantic ? 'var(--accent)' : 'var(--muted)',
        strokeWidth: semantic ? 1.8 : 1,
        strokeDasharray: semantic ? undefined : '5 5',
        opacity: dim ? 0.15 : 1,
      },
      selectable: false,
    };
  });
  const selected = graph.items.find((i) => i.entity.id === selectedId),
    types = [
      ...new Set(
        graph.items.flatMap((i) => (i.relation?.relationType ? [i.relation.relationType] : [])),
      ),
    ].sort();
  function focus(id: string) {
    setSelectedId(id);
    // Hidden neighborhood nodes become visible on the next render before we move the camera.
    requestAnimationFrame(
      () => void flow.fitView({ nodes: [{ id }], duration: 300, padding: 0.8, maxZoom: 1 }),
    );
  }
  const diagram = space.diagrams?.find((d) => d.entityId === selectedId);
  return (
    <>
      <div className="solution-graph-toolbar">
        <label>
          Решение
          <select
            aria-label="Решение для графа"
            value={scope}
            onChange={(e) => router.push(`/solutions?graph=${encodeURIComponent(e.target.value)}`)}
          >
            <option value="all">Все решения и объекты</option>
            {space.objects
              .filter((o) => o.kind === 'solution')
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Подсветить тип
          <select
            aria-label="Подсветить тип связи"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">Все связи</option>
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="solution-graph-check">
          <input
            type="checkbox"
            checked={hierarchy}
            onChange={(e) => setHierarchy(e.target.checked)}
          />
          Вложенность
        </label>
        <label className="solution-graph-check">
          <input
            type="checkbox"
            disabled={!selectedId}
            checked={local && !!selectedId}
            onChange={(e) => setLocal(e.target.checked)}
          />
          Только окружение
        </label>
        <button
          className="secondary small"
          onClick={() => void flow.fitView({ padding: 0.15, duration: 300 })}
        >
          <LocateFixed size={14} />
          Весь граф
        </button>
        <button
          className="secondary small"
          onClick={() => {
            const positions = graphPositions(graph);
            setNodes((ns) => ns.map((n) => ({ ...n, position: positions.get(n.id)! })));
            requestAnimationFrame(() => void flow.fitView({ duration: 300 }));
          }}
        >
          Разложить заново
        </button>
      </div>
      <div className="solution-graph-counts" aria-live="polite">
        Объекты: {graph.items.filter((i) => !i.relation).length} · Связи:{' '}
        {graph.items.filter((i) => i.relation).length} · Вне решения:{' '}
        {graph.items.filter((i) => i.external).length}
      </div>
      <div className="solution-graph-layout">
        <div className="solution-graph-canvas" aria-label="Интерактивный граф связей">
          <ReactFlow<GraphNode>
            nodes={displayNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onEdgeClick={(_, e) => {
              if ('relationId' in e && typeof e.relationId === 'string')
                setSelectedId(e.relationId);
            }}
            onPaneClick={() => {
              setSelectedId(null);
              setLocal(false);
            }}
            nodesConnectable={false}
            nodesFocusable
            onNodeDoubleClick={(_, n) => focus(n.id)}
            edgesReconnectable={false}
            deleteKeyCode={null}
            fitView
            minZoom={0.02}
            maxZoom={2}
            onlyRenderVisibleElements
          >
            <Background color="var(--canvas-dots)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <aside className="solution-graph-inspector">
          <label>
            Найти объект или связь
            <input
              aria-label="Поиск в графе"
              type="search"
              placeholder="Название или тип…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {query.trim() && (
            <div className="solution-graph-results">
              {graph.items
                .filter((i) => matches.has(i.entity.id))
                .map((i) => (
                  <button
                    key={i.entity.id}
                    className="secondary small"
                    onClick={() => focus(i.entity.id)}
                  >
                    {i.entity.name}
                    <small>{i.relation ? 'Связь' : entityLabels[i.entity.kind ?? 'object']}</small>
                  </button>
                ))}
              {matches.size === 0 && <p className="muted">Ничего не найдено.</p>}
            </div>
          )}
          {selected ? (
            <section aria-label="Выбранный элемент графа">
              <h2>{selected.entity.name}</h2>
              <p className="muted">
                {selected.relation ? 'Связь' : entityLabels[selected.entity.kind ?? 'object']}
                {selected.external ? ' · Вне решения' : ''}
              </p>
              {selected.entity.description && (
                <p className="solution-graph-description">{selected.entity.description}</p>
              )}
              {selected.relation && (
                <>
                  <p>Тип: {selected.relation.relationType || 'Без типа'}</p>
                  {(['sourceId', 'targetId'] as const).map((key) => (
                    <div className="solution-graph-participant" key={key}>
                      <small>{key === 'sourceId' ? 'Источник' : 'Назначение'}</small>
                      <button
                        className="secondary small"
                        onClick={() => focus(selected.relation![key])}
                      >
                        {graph.items.find((i) => i.entity.id === selected.relation![key])?.entity
                          .name ?? 'Недоступный участник'}
                      </button>
                    </div>
                  ))}
                </>
              )}
              <dl>
                {Object.entries(selected.entity.attributes).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{String(value)}</dd>
                  </div>
                ))}
              </dl>
              <div className="solution-graph-actions">
                <Link
                  className="secondary small"
                  href={`/solutions?parent=${encodeURIComponent(selected.entity.id)}`}
                >
                  Показать в дереве
                </Link>
                {diagram && (
                  <Link
                    className="secondary small"
                    href={`/solutions?diagram=${encodeURIComponent(diagram.id)}`}
                  >
                    Открыть диаграмму
                  </Link>
                )}
              </div>
            </section>
          ) : (
            <p className="muted">Выберите объект или связь, чтобы увидеть свойства и участников.</p>
          )}
          <p className="muted">
            Перетаскивайте узлы, перемещайте фон и меняйте масштаб. Расстановка в графе не изменяет
            диаграммы.
          </p>
          <p className="muted">
            Стрелки показывают направление связи. Пунктир — вложенность, если она включена.
          </p>
        </aside>
      </div>
    </>
  );
}
