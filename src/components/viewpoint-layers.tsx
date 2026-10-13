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
  useStore,
  type Node,
  type NodeProps,
  type Edge,
  type EdgeProps,
  BaseEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ChevronDown, Layers, RefreshCw } from 'lucide-react';
import { api } from '@/lib/client';
import {
  layerLayout,
  layerConnectionRoute,
  type LayerRoutePlane,
  diagramLayerLayout,
  objectPrism,
  OBJECT_DEPTH,
  DIAGRAM_DEPTH,
  type DiagramLayerLayout,
  viewpointLayers,
  type LayerStructure,
  type LayerConnection,
} from '@/lib/viewpoint-layers';
import { DiagramPreview } from './library';
import { NodeShape } from './node-shape';
import { edgeAppearance, lineDash } from '@/lib/appearance';
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
    surfaceWidth: number;
    toggle: () => void;
  },
  'plane'
>;
type CardNode = Node<
  {
    diagram: LayerStructure['diagrams'][number];
    preview: LayerStructure['previews'][string];
    layout: DiagramLayerLayout;
    focusEntity?: string;
  },
  'diagram'
>;
type ObjectNode = Node<
  {
    item: DiagramLayerLayout['nodes'][number];
    diagramId: string;
    entityId: string;
    shapes: LayerStructure['previews'][string]['notation']['shapes'];
    dim: boolean;
  },
  'object'
>;
type BoundsNode = Node<Record<string, never>, 'bounds'>;
type SceneNode = PlaneNode | CardNode | ObjectNode | BoundsNode;
type LayerEdge = Edge<
  {
    connections: LayerConnection[];
    route: ReturnType<typeof layerConnectionRoute>;
  },
  'layer'
>;
function RoutedEdge({ id, data, label, selected, markerEnd, style }: EdgeProps<LayerEdge>) {
  const [hovered, setHovered] = useState(false);
  const zoom = useStore((state) => state.transform[2]);
  if (!data) return null;
  return (
    <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <BaseEdge
        id={id}
        path={data.route.path}
        markerEnd={markerEnd}
        style={{
          ...style,
          strokeWidth: (Number(style?.strokeWidth) || 2) / zoom,
          strokeDasharray:
            typeof style?.strokeDasharray === 'string'
              ? style.strokeDasharray
                  .split(/\s+/)
                  .map((n) => Number(n) / zoom)
                  .join(' ')
              : style?.strokeDasharray,
          strokeLinejoin: 'round',
          strokeLinecap: 'round',
        }}
        interactionWidth={20}
        label={hovered || selected ? label : undefined}
        labelX={data.route.labelX}
        labelY={data.route.labelY}
        labelStyle={{ fill: 'var(--text)', fontSize: 12 / zoom }}
        labelBgStyle={{ fill: 'var(--panel)' }}
        labelBgPadding={[6 / zoom, 4 / zoom]}
      />
    </g>
  );
}
const edgeTypes = { layer: RoutedEdge };
function Plane({ data }: NodeProps<PlaneNode>) {
  const { width: w, height: h, planeWidth: p, depth, surfaceWidth: u } = data;
  return (
    <div
      className={`viewpoint-plane ${data.collapsed ? 'is-collapsed' : ''}`}
      style={{ width: w, height: h }}
    >
      <svg width={w} height={h} aria-hidden="true">
        <polygon
          points={`0,${u / 4 + 25} ${u},25 ${p},${25 + depth / 4} ${depth},${25 + (u + depth) / 4}`}
        />
        <path
          className="viewpoint-layer-callout"
          d={`M ${p} ${25 + depth * 0.25} L ${p + 85} 40`}
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
      <Handle
        type="target"
        position={Position.Left}
        style={{ left: u / 2 + depth, top: 25 + u / 8 + depth / 4 }}
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{
          left: u / 2 + depth,
          right: 'auto',
          top: 25 + u / 8 + depth / 4,
          transform: 'translate(-50%, -50%)',
        }}
        isConnectable={false}
      />
    </div>
  );
}
function HoverLabel({ name, x, y }: { name: string; x: number; y: number }) {
  const zoom = useStore((state) => state.transform[2]);
  return (
    <div
      className="viewpoint-hover-label"
      role="tooltip"
      style={{
        left: x,
        top: y,
        transform: `translate(-50%, -100%) scale(${1 / zoom})`,
        transformOrigin: 'bottom center',
      }}
    >
      {name}
    </div>
  );
}
function Card({ data, selected }: NodeProps<CardNode>) {
  const [hovered, setHovered] = useState(false);
  const { width: w, depth: d, height: h, minX, minY } = data.layout;
  const preview = data.preview;
  const objects = useMemo(
    () => new Map((preview?.nodes ?? []).map((n) => [n.id, n.objectId])),
    [preview],
  );
  return (
    <div
      className={`viewpoint-diagram-card ${selected ? 'is-selected' : ''}`}
      style={{ width: w + d, height: h + DIAGRAM_DEPTH }}
      data-layer-diagram={data.diagram.id}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ left: w / 2 + d, top: w / 8 + d / 4 + DIAGRAM_DEPTH / 2 }}
        isConnectable={false}
      />
      <svg
        width={w + d}
        height={h + DIAGRAM_DEPTH}
        className="viewpoint-diagram-plane"
        onMouseEnter={() => setHovered(true)}
      >
        <g className="viewpoint-diagram-walls" aria-hidden="true">
          <polygon
            points={`0,${w / 4} ${d},${h} ${d},${h + DIAGRAM_DEPTH} 0,${w / 4 + DIAGRAM_DEPTH}`}
          />
          <polygon
            points={`${d},${h} ${w + d},${d / 4} ${w + d},${d / 4 + DIAGRAM_DEPTH} ${d},${h + DIAGRAM_DEPTH}`}
          />
        </g>
        <polygon
          className="viewpoint-diagram-outline"
          points={`0,${w / 4} ${w},0 ${w + d},${d / 4} ${d},${h}`}
          tabIndex={0}
          aria-label={`Диаграмма: ${data.diagram.name}`}
          onMouseEnter={() => setHovered(true)}
          onFocus={() => setHovered(true)}
          onBlur={() => setHovered(false)}
        />
        {preview && (
          <g transform={`matrix(1 -0.25 1 0.25 0 ${w / 4})`} pointerEvents="none">
            <g transform={`translate(${-minX},${-minY})`}>
              {preview.edges.map((edge) => {
                const geometry = data.layout.edges.get(edge.id);
                const type = preview.notation.edgeTypes.find((t) => t.id === edge.typeId);
                if (!geometry || !type) return null;
                const a = edgeAppearance(type.appearance, edge.appearance);
                const related =
                  !data.focusEntity ||
                  [edge.source, edge.target].some((id) => objects.get(id) === data.focusEntity);
                return (
                  <path
                    key={edge.id}
                    d={geometry.path}
                    fill="none"
                    stroke={a.color}
                    strokeWidth={a.width}
                    strokeDasharray={lineDash(a)}
                    opacity={related ? 1 : 0.12}
                  />
                );
              })}
            </g>
          </g>
        )}
      </svg>
      {hovered && <HoverLabel name={data.diagram.name} x={(w + d) / 2} y={0} />}
      <Handle
        type="source"
        position={Position.Right}
        style={{
          left: w / 2 + d,
          right: 'auto',
          top: w / 8 + d / 4 + DIAGRAM_DEPTH / 2,
          transform: 'translate(-50%, -50%)',
        }}
        isConnectable={false}
      />
    </div>
  );
}
function ObjectCard({ data, selected }: NodeProps<ObjectNode>) {
  const [hovered, setHovered] = useState(false);
  const { appearance: a, node, name } = data.item;
  const prism = useMemo(() => objectPrism(a, data.shapes), [a, data.shapes]);
  return (
    <div
      className={`viewpoint-object-card ${selected ? 'is-selected' : ''} ${data.dim ? 'is-dim' : ''}`}
      style={{ width: prism.width, height: prism.height }}
      data-layer-object={node.id}
      data-layer-entity={data.entityId}
      data-layer-diagram-ref={data.diagramId}
      tabIndex={0}
      aria-label={`Объект: ${name}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ left: prism.front.x, top: prism.front.y }}
        isConnectable={false}
      />
      <svg width={prism.width} height={prism.height} className="viewpoint-object-prism">
        <g className="viewpoint-object-walls" fill={a.stroke} stroke={a.stroke} strokeWidth="1">
          {prism.walls.map((points, i) => (
            <polygon key={i} points={points} />
          ))}
        </g>
        <g className="viewpoint-object-top" transform={`matrix(1 -0.25 1 0.25 0 ${a.width / 4})`}>
          <NodeShape
            className="viewpoint-object-shape"
            appearance={{ ...a, shape: a.shape === 'text' ? 'rectangle' : a.shape }}
            shapes={data.shapes}
          />
        </g>
      </svg>
      {hovered && <HoverLabel name={name} x={prism.width / 2} y={-8} />}
      <Handle
        type="source"
        position={Position.Right}
        style={{
          left: prism.front.x,
          right: 'auto',
          top: prism.front.y,
          transform: 'translate(-50%, -50%)',
        }}
        isConnectable={false}
      />
    </div>
  );
}
const nodeTypes = { plane: Plane, diagram: Card, object: ObjectCard, bounds: () => null };
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
    [selection, setSelection] = useState<
      | { kind: 'diagram' | 'connection'; id: string }
      | { kind: 'object'; id: string; entityId: string; diagramId: string }
      | null
    >(diagramId ? { kind: 'diagram', id: diagramId } : null);
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
  }
  const layouts = useMemo(
    () => new Map(space.diagrams.map((d) => [d.id, diagramLayerLayout(space.previews[d.id])])),
    [space],
  );
  const entities = useMemo(
    () => new Map(space.representations.map((r) => [r.id, r.entityId])),
    [space],
  );
  const lanes = useMemo(
    () =>
      new Map(
        graph.connections
          .map((c) => c.id)
          .sort()
          .map((id, i) => [id, i]),
      ),
    [graph],
  );
  const scene = useMemo(() => {
    const nodes: SceneNode[] = [],
      locations = new Map<
        string,
        { nodeId: string; layerId: string; objects: Map<string, string[]> }
      >();
    const focusEntity = selection?.kind === 'object' ? selection.entityId : undefined;
    const planes = new Map<string, LayerRoutePlane>();
    let top = 0;
    for (const group of graph.groups) {
      const closed = collapsed.has(group.id),
        layout = layerLayout(
          group.diagrams.length,
          closed,
          group.diagrams.map((d) => layouts.get(d.id)!),
        ),
        planeId = `layer:${group.id}`;
      const layerTop = top;
      planes.set(group.id, {
        origin: layerTop + layout.surfaceWidth / 4 + 25,
        depth: layout.depth,
      });
      top += layout.height + 110;
      if (hidden.has(group.id)) continue;
      const items = group.diagrams.filter((d) =>
        d.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      );
      if (!items.length && !empty) continue;
      nodes.push({
        id: planeId,
        type: 'plane',
        className: 'viewpoint-plane-node',
        position: { x: 0, y: layerTop },
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
          surfaceWidth: layout.surfaceWidth,
          toggle: () => toggle(group.id),
        },
        style: { width: layout.width, height: layout.height },
      });
      group.diagrams.forEach((diagram, i) => {
        if (!items.includes(diagram)) return;
        const nodeId = `diagram:${diagram.id}`;
        const objects = new Map<string, string[]>();
        locations.set(diagram.id, {
          nodeId: closed ? planeId : nodeId,
          layerId: group.id,
          objects,
        });
        if (closed) return;
        const tile = layouts.get(diagram.id)!;
        const position = { x: layout.positions[i].x, y: layerTop + layout.positions[i].y };
        nodes.push({
          id: nodeId,
          type: 'diagram',
          position,
          draggable: false,
          zIndex: 1,
          data: { diagram, preview: space.previews[diagram.id], layout: tile, focusEntity },
        });
        tile.nodes.forEach((item) => {
          const entityId = item.node.objectId ?? entities.get(item.node.id) ?? item.node.id;
          const id = `object:${diagram.id}:${item.node.id}`;
          const instances = objects.get(entityId) ?? [];
          instances.push(id);
          objects.set(entityId, instances);
          const u = item.node.position.x - tile.minX,
            v = item.node.position.y - tile.minY;
          nodes.push({
            id,
            type: 'object',
            position: {
              x: position.x + u + v,
              y:
                position.y +
                tile.width / 4 -
                u / 4 +
                v / 4 -
                item.appearance.width / 4 -
                OBJECT_DEPTH,
            },
            draggable: false,
            zIndex: 3,
            data: {
              item,
              entityId,
              diagramId: diagram.id,
              shapes: space.previews[diagram.id].notation.shapes,
              dim: false,
            },
          });
        });
      });
    }
    const endpoint = (c: LayerConnection, side: 'source' | 'target') => {
      const location = locations.get(c[side]);
      if (!location) return undefined;
      const entityId = c.entityId ?? space.diagrams.find((d) => d.id === c[side])?.entityId;
      const aliases = entityId ? location.objects.get(entityId) : undefined;
      const preferred = selection?.kind === 'object' ? selection.id : undefined;
      return aliases?.includes(preferred ?? '') ? preferred : (aliases?.[0] ?? location.nodeId);
    };
    const groups = new Map<
      string,
      { source: string; target: string; connections: LayerConnection[] }
    >();
    for (const c of graph.connections) {
      const source = endpoint(c, 'source'),
        target = endpoint(c, 'target');
      if (
        !source ||
        !target ||
        (kind !== 'all' && kind !== c.kind) ||
        (interOnly && locations.get(c.source)!.layerId === locations.get(c.target)!.layerId) ||
        source === target
      )
        continue;
      const key = `${source}:${target}:${c.kind}`;
      const group = groups.get(key) ?? { source, target, connections: [] };
      group.connections.push(c);
      groups.set(key, group);
    }
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const entityFor = (id: string) => {
      const node = byId.get(id);
      return node?.type === 'object'
        ? node.data.entityId
        : node?.type === 'diagram'
          ? node.data.diagram.entityId
          : undefined;
    };
    const port = (id: string) => {
      const n = byId.get(id)!;
      if (n.type === 'object') {
        const p = objectPrism(n.data.item.appearance, n.data.shapes).front;
        return { x: n.position.x + p.x, y: n.position.y + p.y };
      }
      if (n.type === 'diagram') {
        const { width, depth } = n.data.layout;
        return {
          x: n.position.x + width / 2 + depth,
          y: n.position.y + width / 8 + depth / 4 + DIAGRAM_DEPTH / 2,
        };
      }
      if (n.type === 'plane')
        return {
          x: n.position.x + n.data.surfaceWidth / 2 + n.data.depth,
          y: n.position.y + 25 + n.data.surfaceWidth / 8 + n.data.depth / 4,
        };
      return n.position;
    };
    const neighborhood = new Set<string>(focusEntity ? [focusEntity] : []);
    const edges: LayerEdge[] = [...groups].map(([id, group]) => {
      const { source, target, connections } = group;
      const c = connections[0],
        color = colors[c.kind];
      const related =
        !focusEntity ||
        connections.some((c) => c.entityId === focusEntity) ||
        entityFor(source) === focusEntity ||
        entityFor(target) === focusEntity;
      if (focusEntity && related) {
        for (const nodeId of [source, target]) {
          const entityId = entityFor(nodeId);
          if (entityId) neighborhood.add(entityId);
        }
      }
      return {
        id,
        source,
        target,
        type: 'layer',
        data: {
          connections,
          route: layerConnectionRoute(
            port(source),
            port(target),
            planes.get(locations.get(c.source)!.layerId)!,
            planes.get(locations.get(c.target)!.layerId)!,
            Math.min(...connections.map((c) => lanes.get(c.id)!)),
          ),
        },
        className: related ? 'is-related' : 'is-dim',
        label:
          connections.length > 1
            ? `${kindNames[c.kind]} ×${connections.length}`
            : kindNames[c.kind],
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12 },
        style: {
          stroke: color,
          strokeWidth: focusEntity && related ? 3 : 2,
          strokeDasharray: c.kind === 'decomposition' ? '6 4' : undefined,
        },
        labelStyle: { fill: 'var(--text)', fontSize: 11 },
        labelBgStyle: { fill: 'var(--panel)' },
        labelBgPadding: [6, 4],
        zIndex: 2,
        selected: selection?.kind === 'connection' && selection.id === id,
      };
    });
    if (edges.length) {
      // Reserve the full routing envelope so filtering or selecting an alias never refits the scene.
      const lastLane = Math.max(0, lanes.size - 1);
      const diagramLayers = new Map(
        graph.groups.flatMap((g) => g.diagrams.map((d) => [d.id, g.id] as const)),
      );
      const referencedLayers = new Set(
        graph.connections.flatMap((c) => [
          diagramLayers.get(c.source)!,
          diagramLayers.get(c.target)!,
        ]),
      );
      const bottom = Math.max(
        ...[...referencedLayers].map((id) => {
          const plane = planes.get(id)!;
          return plane.origin + plane.depth / 2 + 56 + lastLane * 6;
        }),
      );
      for (const [id, position] of [
        ['route-min', { x: -200 - lastLane * 24, y: 0 }],
        ['route-max', { x: 0, y: bottom }],
      ] as const)
        nodes.push({
          id,
          type: 'bounds',
          position,
          data: {},
          width: 1,
          height: 1,
          draggable: false,
          selectable: false,
          zIndex: -1,
          style: { width: 1, height: 1, pointerEvents: 'none' },
        });
    }
    if (focusEntity)
      for (const document of Object.values(space.previews)) {
        const objects = new Map(document.nodes.map((n) => [n.id, n.objectId]));
        for (const edge of document.edges) {
          const source = objects.get(edge.source),
            target = objects.get(edge.target);
          if (source === focusEntity || target === focusEntity) {
            if (source) neighborhood.add(source);
            if (target) neighborhood.add(target);
          }
        }
      }
    return {
      nodes: nodes.map<SceneNode>((n) => {
        if (n.type === 'object')
          return {
            ...n,
            selected: n.data.entityId === focusEntity,
            data: { ...n.data, dim: !!focusEntity && !neighborhood.has(n.data.entityId) },
          };
        return {
          ...n,
          selected:
            n.type === 'diagram' &&
            selection?.kind === 'diagram' &&
            selection.id === n.data.diagram.id,
        };
      }),
      edges,
      locations,
    };
  }, [
    graph,
    lanes,
    space,
    layouts,
    entities,
    collapsed,
    hidden,
    query,
    kind,
    interOnly,
    empty,
    selection,
  ]);
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
  function focusObject(id: string, diagramId: string) {
    const group = graph.groups.find((g) => g.diagrams.some((d) => d.id === diagramId));
    if (!group) return;
    setHidden((old) => new Set([...old].filter((key) => key !== group.id)));
    setCollapsed((old) => new Set([...old].filter((key) => key !== group.id)));
    setQuery('');
    requestAnimationFrame(
      () => void flow.fitView({ nodes: [{ id }], padding: 1, maxZoom: 2.5, duration: 300 }),
    );
  }
  const selectedObject =
    selection?.kind === 'object'
      ? scene.nodes.find((n): n is ObjectNode => n.type === 'object' && n.id === selection.id)
      : undefined;
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
            }}
          />
          Пустые слои
        </label>
        <button
          className="secondary small"
          onClick={() => {
            setCollapsed(new Set(graph.groups.map((g) => g.id)));
          }}
        >
          Свернуть все слои
        </button>
        <button
          className="secondary small"
          onClick={() => {
            setCollapsed(new Set());
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
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            elevateNodesOnSelect={false}
            nodesConnectable={false}
            edgesReconnectable={false}
            deleteKeyCode={null}
            minZoom={0.03}
            maxZoom={4}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            onNodeClick={(_, n) => {
              if (n.type === 'diagram') setSelection({ kind: 'diagram', id: n.data.diagram.id });
              if (n.type === 'object')
                setSelection({
                  kind: 'object',
                  id: n.id,
                  entityId: n.data.entityId,
                  diagramId: n.data.diagramId,
                });
            }}
            onNodeDoubleClick={(_, n) => {
              if (n.type === 'diagram') focus(n.data.diagram.id);
              if (n.type === 'object') focusObject(n.id, n.data.diagramId);
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
                n.type === 'bounds'
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
          {selection?.kind === 'object' && (
            <section aria-label="Выбранный объект слоя">
              <h2>
                {space.objects.find((o) => o.id === selection.entityId)?.name ??
                  selectedObject?.data.item.name}
              </h2>
              <p className="muted">
                Выделены связи этого объекта и его представления на других диаграммах.
              </p>
              <div className="button-row">
                <button
                  className="secondary small"
                  onClick={() => focusObject(selection.id, selection.diagramId)}
                >
                  Фокусировать объект
                </button>
                <button className="secondary small" onClick={() => setSelection(null)}>
                  Сбросить фокус
                </button>
                <Link className="secondary small" href={`/solutions?parent=${selection.entityId}`}>
                  Показать в дереве
                </Link>
              </div>
            </section>
          )}
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
            фон, меняйте масштаб и выбирайте объекты, диаграммы или линии связей. Двойной щелчок по
            объекту приближает его.
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
