'use client';
import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeProps,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ChevronDown, FileText, Layers, RefreshCw } from 'lucide-react';
import { api } from '@/lib/client';
import {
  layerLayout,
  viewpointLayers,
  type LayerStructure,
  type LayerConnection,
} from '@/lib/viewpoint-layers';
import { DiagramPreview } from './library';
const kindNames = {
  decomposition: 'Декомпозиция',
  viewpoint: 'Другой ракурс',
  relation: 'Связь диаграмм',
};
const colors = { decomposition: '#4d87c7', viewpoint: '#8774e4', relation: '#329882' };
type PlaneNode = Node<
  {
    name: string;
    count: number;
    collapsed: boolean;
    width: number;
    height: number;
    planeWidth: number;
    depth: number;
    toggle: () => void;
  },
  'plane'
>;
type CardNode = Node<
  { diagram: LayerStructure['diagrams'][number]; preview: LayerStructure['previews'][string] },
  'diagram'
>;
type OrderNode = Node<{ distance: number }, 'order'>;
type SceneNode = PlaneNode | CardNode | OrderNode;
function Plane({ data }: NodeProps<PlaneNode>) {
  const { width: w, height: h, planeWidth: p, depth } = data;
  return (
    <div
      className={`viewpoint-plane ${data.collapsed ? 'is-collapsed' : ''}`}
      style={{ width: w, height: h }}
    >
      <svg width={w} height={h} aria-hidden="true">
        <polygon
          points={
            data.collapsed
              ? `0,30 740,0 900,40 160,70`
              : `0,210 740,25 ${p},${25 + depth * 0.25} ${depth},${210 + depth * 0.25}`
          }
        />
        <path
          className="viewpoint-layer-callout"
          d={`M ${p} ${data.collapsed ? 40 : 25 + depth * 0.25} L ${p + 85} 40`}
        />
      </svg>
      <button
        className="nodrag nopan viewpoint-plane-heading"
        style={{ left: p + 85, top: 0, width: 300, height: 80 }}
        title={data.name}
        onClick={data.toggle}
        aria-expanded={!data.collapsed}
        aria-label={`${data.collapsed ? 'Раскрыть' : 'Свернуть'} слой ${data.name}`}
      >
        <ChevronDown
          size={17}
          style={{ transform: data.collapsed ? 'rotate(-90deg)' : undefined }}
        />
        <Layers size={16} />
        <strong>{data.name}</strong>
        <span>{data.count} диаграмм</span>
      </button>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
function Card({ data, selected }: NodeProps<CardNode>) {
  return (
    <div
      className={`viewpoint-diagram-card ${selected ? 'is-selected' : ''}`}
      data-layer-diagram={data.diagram.id}
      title={data.diagram.name}
    >
      <Handle type="target" position={Position.Left} style={{ top: 65 }} isConnectable={false} />
      <svg width="320" height="115" className="viewpoint-diagram-prism">
        <polygon className="prism-front" points="0,50 120,80 320,30 320,60 120,110 0,80" />
        <polygon className="prism-side" points="0,50 120,80 120,110 0,80" />
        <polygon className="prism-top" points="0,50 200,0 320,30 120,80" />
        <foreignObject width="240" height="120" transform="matrix(0.833333 -0.208333 1 0.25 0 50)">
          <div className="viewpoint-diagram-surface">
            <div className="viewpoint-diagram-miniature">
              {data.preview && <DiagramPreview document={data.preview} />}
            </div>
            <div className="viewpoint-diagram-caption">
              <FileText size={14} />
              <strong>{data.diagram.name}</strong>
            </div>
          </div>
        </foreignObject>
      </svg>
      <Handle type="source" position={Position.Right} style={{ top: 45 }} isConnectable={false} />
    </div>
  );
}
function Order({ data }: NodeProps<OrderNode>) {
  const d = data.distance;
  return (
    <svg className="viewpoint-layer-order" width="180" height={d + 30} aria-hidden="true">
      <path
        d={`M 165 15 C 10 15 10 ${d - 15} 165 ${d - 15} M 147 ${d - 33} L 165 ${d - 15} L 147 ${d + 3}`}
      />
    </svg>
  );
}
const nodeTypes = { plane: Plane, diagram: Card, order: Order };
export function ViewpointLayersPage({ diagramId }: { diagramId?: string }) {
  const [space, setSpace] = useState<LayerStructure | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try {
      setSpace(await api<LayerStructure>('model/layers'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <main className="page viewpoint-layers-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">РАБОЧАЯ ОБЛАСТЬ · 2.5D</div>
          <h1>Слои ракурсов</h1>
          <p className="muted">Диаграммы на плоскостях ракурсов и переходы между ними.</p>
        </div>
        <div className="button-row">
          <Link
            className="secondary"
            href={diagramId ? `/solutions?diagram=${diagramId}` : '/solutions'}
          >
            {diagramId ? 'К диаграмме' : 'К дереву решений'}
          </Link>
          <button className="secondary" disabled={busy} onClick={() => void load()}>
            <RefreshCw size={16} />
            Обновить
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {space ? (
        <ReactFlowProvider>
          <Scene space={space} diagramId={diagramId} />
        </ReactFlowProvider>
      ) : (
        <p className="muted">{busy ? 'Загружаем слои…' : 'Слои недоступны. Повторите загрузку.'}</p>
      )}
    </main>
  );
}
function Scene({ space, diagramId }: { space: LayerStructure; diagramId?: string }) {
  const flow = useReactFlow<SceneNode>();
  const graph = useMemo(() => viewpointLayers(space), [space]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [hidden, setHidden] = useState<Set<string>>(new Set()),
    [query, setQuery] = useState(''),
    [kind, setKind] = useState('all'),
    [interOnly, setInterOnly] = useState(false),
    [empty, setEmpty] = useState(false),
    [selection, setSelection] = useState<{ kind: 'diagram' | 'connection'; id: string } | null>(
      diagramId ? { kind: 'diagram', id: diagramId } : null,
    );
  function fit() {
    requestAnimationFrame(() => void flow.fitView({ duration: 300, padding: 0.15 }));
  }
  function toggle(id: string) {
    setCollapsed((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    fit();
  }
  const scene = useMemo(() => {
    const nodes: SceneNode[] = [],
      locations = new Map<string, { nodeId: string; layerId: string }>();
    let top = 0;
    const visibleGroups = graph.groups
      .map((group) => ({
        ...group,
        diagrams: group.diagrams.filter((d) =>
          d.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
        ),
      }))
      .filter((g) => !hidden.has(g.id) && (g.diagrams.length || empty));
    for (const [index, group] of visibleGroups.entries()) {
      const items = group.diagrams;
      const closed = collapsed.has(group.id),
        layout = layerLayout(items.length, closed),
        planeId = `layer:${group.id}`;
      nodes.push({
        id: planeId,
        type: 'plane',
        className: 'viewpoint-plane-node',
        position: { x: 0, y: top },
        draggable: false,
        selectable: false,
        zIndex: 0,
        data: {
          name: group.name,
          count: items.length,
          collapsed: closed,
          width: layout.width,
          height: layout.height,
          planeWidth: layout.planeWidth,
          depth: layout.depth,
          toggle: () => toggle(group.id),
        },
        style: { width: layout.width, height: layout.height },
      });
      items.forEach((diagram, i) => {
        const nodeId = `diagram:${diagram.id}`;
        locations.set(diagram.id, { nodeId: closed ? planeId : nodeId, layerId: group.id });
        if (!closed)
          nodes.push({
            id: nodeId,
            type: 'diagram',
            position: { x: layout.positions[i].x, y: top + layout.positions[i].y },
            draggable: false,
            zIndex: 3,
            data: { diagram, preview: space.previews[diagram.id] },
          });
      });
      const next = visibleGroups[index + 1];
      if (next) {
        const anchor = closed ? 30 : 210,
          nextAnchor = collapsed.has(next.id) ? 30 : 210;
        const distance = layout.height + 110 + nextAnchor - anchor;
        nodes.push({
          id: `order:${group.id}`,
          type: 'order',
          className: 'viewpoint-order-node',
          position: { x: -190, y: top + anchor - 15 },
          draggable: false,
          selectable: false,
          zIndex: 1,
          style: { width: 180, height: distance + 30 },
          data: { distance },
        });
      }
      top += layout.height + 110;
    }
    const groups = new Map<string, LayerConnection[]>();
    for (const connection of graph.connections) {
      const source = locations.get(connection.source),
        target = locations.get(connection.target);
      if (
        !source ||
        !target ||
        (kind !== 'all' && kind !== connection.kind) ||
        (interOnly && source.layerId === target.layerId)
      )
        continue;
      if (source.nodeId === target.nodeId && collapsed.has(source.layerId)) continue;
      const key = `${source.nodeId}:${target.nodeId}:${connection.kind}`;
      const members = groups.get(key) ?? [];
      members.push(connection);
      groups.set(key, members);
    }
    const edges: Edge<{ connections: LayerConnection[] }>[] = [...groups].map(
      ([id, connections]) => {
        const c = connections[0],
          color = colors[c.kind];
        return {
          id,
          source: locations.get(c.source)!.nodeId,
          target: locations.get(c.target)!.nodeId,
          data: { connections },
          label:
            connections.length > 1
              ? `${kindNames[c.kind]} ×${connections.length}`
              : kindNames[c.kind],
          markerEnd: { type: MarkerType.ArrowClosed, color },
          style: {
            stroke: color,
            strokeWidth: 2,
            strokeDasharray: c.kind === 'decomposition' ? '6 4' : undefined,
          },
          labelStyle: { fill: 'var(--text)', fontSize: 11 },
          labelBgStyle: { fill: 'var(--panel)' },
          labelBgPadding: [6, 4],
          zIndex: 2,
          selected: selection?.kind === 'connection' && selection.id === id,
        };
      },
    );
    return {
      nodes: nodes.map((n) => ({
        ...n,
        selected:
          n.type === 'diagram' &&
          selection?.kind === 'diagram' &&
          selection.id === n.data.diagram.id,
      })),
      edges,
      locations,
    };
  }, [graph, space.previews, collapsed, hidden, query, kind, interOnly, empty, selection]);
  function focus(id: string) {
    const group = graph.groups.find((g) => g.diagrams.some((d) => d.id === id));
    if (!group) return;
    setHidden((old) => {
      const next = new Set(old);
      next.delete(group.id);
      return next;
    });
    setCollapsed((old) => {
      const next = new Set(old);
      next.delete(group.id);
      return next;
    });
    setQuery('');
    setSelection({ kind: 'diagram', id });
    requestAnimationFrame(
      () =>
        void flow.fitView({
          nodes: [{ id: `diagram:${id}` }],
          duration: 300,
          padding: 0.7,
          maxZoom: 1,
        }),
    );
  }
  const selectedDiagram =
    selection?.kind === 'diagram' ? space.diagrams.find((d) => d.id === selection.id) : undefined;
  const selectedConnections =
    selection?.kind === 'connection'
      ? scene.edges.find((e) => e.id === selection.id)?.data?.connections
      : undefined;
  const matches = space.diagrams.filter((d) =>
    d.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <div className="viewpoint-layers-toolbar">
        <label>
          Связи
          <select
            aria-label="Тип связей слоёв"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="all">Все связи</option>
            {Object.entries(kindNames).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={interOnly}
            onChange={(e) => setInterOnly(e.target.checked)}
          />
          Только межслойные
        </label>
        <label>
          <input
            type="checkbox"
            checked={empty}
            onChange={(e) => {
              setEmpty(e.target.checked);
              fit();
            }}
          />
          Пустые слои
        </label>
        <button
          className="secondary small"
          onClick={() => {
            setCollapsed(new Set(graph.groups.map((g) => g.id)));
            fit();
          }}
        >
          Свернуть все слои
        </button>
        <button
          className="secondary small"
          onClick={() => {
            setCollapsed(new Set());
            fit();
          }}
        >
          Раскрыть все слои
        </button>
        <button className="secondary small" onClick={fit}>
          Вписать слои
        </button>
      </div>
      <p className="viewpoint-layers-counts" aria-live="polite">
        Диаграммы: {scene.locations.size} из {space.diagrams.length} · Связи:{' '}
        {scene.edges.reduce((n, e) => n + (e.data?.connections.length ?? 0), 0)} · Переходы без
        источника: {graph.unresolved.length}
      </p>
      <div className="viewpoint-layers-layout">
        <div className="viewpoint-layers-canvas" aria-label="Обозреватель слоёв 2.5D">
          <ReactFlow<SceneNode>
            nodes={scene.nodes}
            edges={scene.edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesReconnectable={false}
            deleteKeyCode={null}
            minZoom={0.03}
            maxZoom={2}
            fitView
            onlyRenderVisibleElements
            onNodeClick={(_, n) => {
              if (n.type === 'diagram') setSelection({ kind: 'diagram', id: n.data.diagram.id });
            }}
            onNodeDoubleClick={(_, n) => {
              if (n.type === 'diagram') focus(n.data.diagram.id);
            }}
            onEdgeClick={(_, e) => setSelection({ kind: 'connection', id: e.id })}
            onPaneClick={() => setSelection(null)}
          >
            <Background color="var(--canvas-dots)" />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) =>
                n.type === 'order'
                  ? 'transparent'
                  : n.type === 'plane'
                    ? 'var(--accent-soft)'
                    : 'var(--accent)'
              }
            />
          </ReactFlow>
          {!scene.nodes.length && (
            <div className="viewpoint-layers-empty">
              {space.diagrams.length
                ? 'Нет диаграмм по выбранным фильтрам.'
                : 'В этой рабочей области пока нет диаграмм.'}
            </div>
          )}
        </div>
        <aside className="viewpoint-layers-inspector">
          <label>
            Найти диаграмму
            <input
              type="search"
              aria-label="Поиск диаграмм в слоях"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Название диаграммы…"
            />
          </label>
          {query.trim() && (
            <div className="viewpoint-layer-results">
              {matches.map((d) => (
                <button className="secondary small" key={d.id} onClick={() => focus(d.id)}>
                  {d.name}
                </button>
              ))}
              {!matches.length && <p className="muted">Ничего не найдено.</p>}
            </div>
          )}
          <section aria-label="Видимые слои">
            <h2>Слои</h2>
            {graph.groups.map((g) => (
              <div className="viewpoint-layer-control" key={g.id}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Показать слой ${g.name}`}
                    checked={!hidden.has(g.id)}
                    onChange={(e) => {
                      setHidden((old) => {
                        const next = new Set(old);
                        if (e.target.checked) next.delete(g.id);
                        else next.add(g.id);
                        return next;
                      });
                      fit();
                    }}
                  />
                  <span title={g.description}>
                    {g.name}
                    <small>{g.diagrams.length} диаграмм</small>
                  </span>
                </label>
                <button
                  className="icon-button"
                  aria-label={`${collapsed.has(g.id) ? 'Раскрыть' : 'Свернуть'} ракурс ${g.name}`}
                  onClick={() => toggle(g.id)}
                >
                  <ChevronDown
                    size={15}
                    style={{ transform: collapsed.has(g.id) ? 'rotate(-90deg)' : undefined }}
                  />
                </button>
              </div>
            ))}
          </section>
          {selectedDiagram && (
            <section aria-label="Выбранная диаграмма слоя">
              <h2>{selectedDiagram.name}</h2>
              <p className="muted">
                {space.viewpoints.find((v) => v.id === selectedDiagram.viewpointId)?.name ??
                  'Без ракурса'}{' '}
                · Ревизия {selectedDiagram.revision}
              </p>
              <div className="viewpoint-selected-preview">
                <DiagramPreview document={space.previews[selectedDiagram.id]} />
              </div>
              <Link className="secondary small" href={`/solutions?diagram=${selectedDiagram.id}`}>
                Открыть диаграмму
              </Link>
            </section>
          )}
          {selectedConnections && (
            <section aria-label="Выбранные связи слоёв">
              <h2>Связи: {selectedConnections.length}</h2>
              {selectedConnections.map((c) => (
                <div className="viewpoint-layer-connection" key={c.id}>
                  <strong>
                    {kindNames[c.kind]} · {c.name}
                  </strong>
                  <button className="secondary small" onClick={() => focus(c.source)}>
                    {space.diagrams.find((d) => d.id === c.source)?.name}
                  </button>
                  <span>↓</span>
                  <button className="secondary small" onClick={() => focus(c.target)}>
                    {space.diagrams.find((d) => d.id === c.target)?.name}
                  </button>
                  {c.meaning && <p>{c.meaning}</p>}
                  {c.inferred && (
                    <p className="muted">
                      Исходная диаграмма определена по существующему представлению объекта.
                    </p>
                  )}
                  <Link href={`/solutions?parent=${c.relationId}`}>Показать связь в дереве</Link>
                </div>
              ))}
            </section>
          )}
          {!!graph.unresolved.length && (
            <details className="viewpoint-unresolved">
              <summary>Переходы без исходной диаграммы ({graph.unresolved.length})</summary>
              <p className="muted">
                У этих переходов не задана исходная диаграмма и нет представления объекта на другой
                диаграмме.
              </p>
              {graph.unresolved.map((l) => (
                <div key={l.id}>
                  <strong>
                    {space.objects.find((o) => o.id === l.entityId)?.name ??
                      space.relations.find((r) => r.id === l.entityId)?.name}
                  </strong>
                  <Link href={`/solutions?diagram=${l.targetDiagramId}`}>
                    {space.diagrams.find((d) => d.id === l.targetDiagramId)?.name}
                  </Link>
                </div>
              ))}
            </details>
          )}
          <p className="muted">
            Порядок ракурсов задаёт порядок плоскостей. Переходы могут пропускать слои. Перемещайте
            фон, меняйте масштаб и выбирайте диаграммы или линии связей.
          </p>
          <div className="viewpoint-layer-legend">
            {Object.entries(kindNames).map(([id, name]) => (
              <span key={id}>
                <i style={{ background: colors[id as LayerConnection['kind']] }} />
                {name}
              </span>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}
