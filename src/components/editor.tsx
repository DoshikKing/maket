'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  useNodesInitialized,
  type NodeChange,
  type EdgeChange,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft,
  Save,
  Download,
  Upload,
  Undo2,
  Redo2,
  History,
  Trash2,
  Plus,
  MousePointer2,
  GitBranch,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { api, date, download, readJson } from '@/lib/client';
import { type DiagramDocument as LegacyDocument, defaults } from '@/lib/notation';
import { useUser } from './workspace';
import { Modal } from './modal';
import {
  diagramNodeTypes,
  NodeActionsContext,
  type ShapeNode,
  type ShapeData,
} from './diagram-node';
import { EdgeMarkers, markerId } from './edge-markers';
import { NumberField, TextAppearanceControls, EdgeAppearanceControls } from './appearance-controls';
import {
  nodeAppearance,
  nodeLabel,
  edgeAppearance,
  lineDash,
  moveLayer,
  baseShapes,
  type NodeOverride,
  type EdgeOverride,
} from '@/lib/appearance';
import { RelationBrowser, RelationEditor, RelationPlacement } from './relation-browser';
import { ObjectTree, ObjectEditor } from './object-tree';
import { DiagramPreview, type NotationItem } from './library';
import {
  projectDocument,
  connectionTypeForSource,
  mergeModelObjects,
  packDocument,
  modelErrors,
  effectiveNode,
  effectiveEdge,
  type ModelRelation,
  qualify,
  splitType,
  portableDiagramSchema,
  displayedView,
  type ModelDiagram,
  type ModelObject,
  type Space,
  type ViewDocument,
  type ModelDocument,
} from '@/lib/model';
type DiagramDocument = ViewDocument;
type Diagram = {
  id: string;
  name: string;
  revision: number;
  document: ViewDocument;
  objects: ModelObject[];
  relations: ModelRelation[];
};

export function EditorPage({ id }: { id: string }) {
  const [diagram, setDiagram] = useState<Diagram | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    Promise.all([api<ModelDiagram>(`diagrams/${id}`), api<Space>('model')])
      .then(([d, space]) =>
        setDiagram({
          ...d,
          document: projectDocument(d.document),
          objects: mergeModelObjects(space.objects, d.document.objects),
          relations: mergeModelObjects(space.relations ?? [], d.document.relations ?? []),
        }),
      )
      .catch((e) => setError(e.message));
  }, [id]);
  return diagram ? (
    <ReactFlowProvider>
      <Editor initial={diagram} />
    </ReactFlowProvider>
  ) : (
    <div className="empty">{error || 'Открываем диаграмму…'}</div>
  );
}
function Editor({ initial }: { initial: Diagram }) {
  const { user } = useUser(),
    flow = useReactFlow(),
    router = useRouter();
  const nodesInitialized = useNodesInitialized();
  const [name, setName] = useState(initial.name),
    [document, setDocument] = useState(initial.document),
    [revision, setRevision] = useState(initial.revision),
    [selected, setSelected] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null),
    [edgeType, setEdgeType] = useState(initial.document.notation.edgeTypes[0].id),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false),
    [revisions, setRevisions] = useState<{ number: number; createdAt: string; reason: string }[]>(
      [],
    ),
    [savedDoc, setSavedDoc] = useState(JSON.stringify(initial.document)),
    [undo, setUndo] = useState<DiagramDocument[]>([]),
    [redo, setRedo] = useState<DiagramDocument[]>([]),
    [blocked, setBlocked] = useState(false),
    [interacting, setInteracting] = useState(false),
    [objects, setObjects] = useState(initial.objects),
    [relations, setRelations] = useState(initial.relations),
    [relationEditing, setRelationEditing] = useState<ModelRelation | 'new' | null>(null),
    [relationPlacement, setRelationPlacement] = useState<ModelRelation | null>(null),
    [objectEditing, setObjectEditing] = useState<ModelObject | null>(null),
    [commandBusy, setCommandBusy] = useState(false),
    [objectSaving, setObjectSaving] = useState(false),
    [notationsOpen, setNotationsOpen] = useState(false),
    [availableNotations, setAvailableNotations] = useState<NotationItem[]>([]),
    [placementType, setPlacementType] = useState(initial.document.notation.nodeTypes[0].id),
    [skinChange, setSkinChange] = useState<{
      nodeId: string;
      typeId: string;
      ports: Record<string, string>;
      types: Record<string, string>;
    } | null>(null),
    [historical, setHistorical] = useState<ModelDocument | LegacyDocument | null>(null),
    [placementRequest, setPlacementRequest] = useState<{
      typeId: string;
      objectId?: string;
      position?: { x: number; y: number };
      values: ModelObject['attributes'];
    } | null>(null);
  const docRef = useRef(document),
    revisionRef = useRef(revision),
    savingRef = useRef(false),
    gesture = useRef<DiagramDocument | null>(null),
    file = useRef<HTMLInputElement>(null);
  const objectWrites = useRef<Promise<unknown>>(Promise.resolve());
  const objectGeneration = useRef(0),
    refreshSequence = useRef(0);
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const relationsRef = useRef(relations);
  relationsRef.current = relations;
  const allRelations = useMemo(
    () =>
      mergeModelObjects(
        (document.relations ?? []).filter((r) => document.edges.some((e) => e.relationId === r.id)),
        relations,
      ),
    [relations, document.relations, document.edges],
  );
  const relationLookup = useMemo(() => new Map(allRelations.map((r) => [r.id, r])), [allRelations]);
  const mergeRelations = useCallback((updates: ModelRelation[], replace = false) => {
    const next = mergeModelObjects(relationsRef.current, updates, replace);
    if (
      next.length === relationsRef.current.length &&
      next.every((r, i) => r === relationsRef.current[i])
    )
      return;
    objectGeneration.current++;
    relationsRef.current = next;
    setRelations(next);
  }, []);
  const objectLookup = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects]);
  const mergeObjects = useCallback((updates: ModelObject[], replace = false) => {
    const previous = new Map(objectsRef.current.map((o) => [o.id, o]));
    const next = mergeModelObjects(objectsRef.current, updates, replace);
    if (next.length === objectsRef.current.length && next.every((o) => previous.get(o.id) === o))
      return;
    objectGeneration.current++;
    objectsRef.current = next;
    setObjects(next);
  }, []);
  const refreshObjects = useCallback(async () => {
    const generation = objectGeneration.current,
      sequence = ++refreshSequence.current;
    try {
      const space = await api<Space>('model');
      if (generation === objectGeneration.current && sequence === refreshSequence.current) {
        mergeObjects(space.objects, true);
        mergeRelations(space.relations ?? [], true);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [mergeObjects, mergeRelations]);
  useEffect(() => {
    const refresh = () => {
      if (!window.document.hidden) void refreshObjects();
    };
    const timer = setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [refreshObjects]);
  const serialized = useMemo(() => JSON.stringify(document), [document]);
  const dirty = serialized !== savedDoc;
  const errors = useMemo(
    () => modelErrors(packDocument(document, objects, relations)),
    [document, objects, relations],
  );
  const change = useCallback((next: DiagramDocument, record = true) => {
    if (JSON.stringify(next) === JSON.stringify(docRef.current)) return;
    if (record) {
      const previous = structuredClone(docRef.current);
      setUndo((u) => [...u.slice(-49), previous]);
      setRedo([]);
    }
    docRef.current = next;
    setDocument(next);
    setError('');
  }, []);
  const save = useCallback(
    async (retry = false): Promise<boolean> => {
      if (gesture.current || savingRef.current || (blocked && !retry)) return false;
      await objectWrites.current;
      if (gesture.current || savingRef.current) return false;
      const snapshot = docRef.current;
      const packed = packDocument(snapshot, objectsRef.current, relationsRef.current);
      const issues = modelErrors(packed);
      if (issues.length) {
        setError(issues.join('; '));
        return false;
      }
      savingRef.current = true;
      setSaving(true);
      setError('');
      try {
        const result = await api<ModelDiagram>(`diagrams/${initial.id}`, 'PUT', {
          revision: revisionRef.current,
          document: packed,
        });
        mergeRelations(result.document.relations ?? []);
        revisionRef.current = result.revision;
        setRevision(result.revision);
        setSavedDoc(JSON.stringify(snapshot));
        setBlocked(false);
        return JSON.stringify(docRef.current) === JSON.stringify(snapshot);
      } catch (e) {
        const message = (e as Error).message;
        setError(message);
        setBlocked(true);
        return false;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [initial.id, blocked],
  );
  useEffect(() => {
    if (!dirty || interacting || !user.settings.autosave || errors.length || blocked || saving)
      return;
    const timer = setTimeout(() => void save(), 1500);
    return () => clearTimeout(timer);
  }, [
    serialized,
    savedDoc,
    dirty,
    interacting,
    user.settings.autosave,
    errors.length,
    blocked,
    saving,
    save,
  ]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    const navigate = async (event: MouseEvent) => {
      const anchor = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
      if (
        !dirty ||
        !anchor ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        anchor.target === '_blank' ||
        anchor.hasAttribute('download')
      )
        return;
      const url = new URL(anchor.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      if (savingRef.current) {
        setError('Дождитесь завершения сохранения и повторите переход.');
        return;
      }
      if (user.settings.autosave && !errors.length && !blocked) {
        if (await save()) router.push(url.pathname + url.search);
      } else if (confirm('Есть несохранённые изменения. Перейти и потерять их?'))
        router.push(url.pathname + url.search);
    };
    window.document.addEventListener('click', navigate, true);
    return () => window.document.removeEventListener('click', navigate, true);
  });
  const beginGesture = useCallback((_kind: 'drag' | 'resize' | 'text') => {
    if (gesture.current) return;
    gesture.current = structuredClone(docRef.current);
    setInteracting(true);
  }, []);
  const endGesture = useCallback(() => {
    queueMicrotask(() => {
      const previous = gesture.current;
      if (previous && JSON.stringify(previous) !== JSON.stringify(docRef.current)) {
        setUndo((u) => [...u.slice(-49), previous]);
        setRedo([]);
      }
      gesture.current = null;
      setInteracting(false);
    });
  }, []);
  const setNodeLabel = useCallback(
    (id: string, text: string) => {
      const node = docRef.current.nodes.find((n) => n.id === id);
      if (!node) return;
      change(
        {
          ...docRef.current,
          nodes: docRef.current.nodes.map((n) => (n.id === id ? { ...n, label: text } : n)),
        },
        false,
      );
    },
    [change],
  );
  const nodeActions = useMemo(
    () => ({ begin: beginGesture, end: endGesture, label: setNodeLabel }),
    [beginGesture, endGesture, setNodeLabel],
  );
  function updateNodeAppearance(patch: NodeOverride) {
    if (selected?.kind !== 'node') return;
    change({
      ...docRef.current,
      nodes: docRef.current.nodes.map((n) =>
        n.id === selected.id ? { ...n, appearance: { ...n.appearance, ...patch } } : n,
      ),
    });
  }
  function updateEdgeAppearance(patch: EdgeOverride) {
    if (selected?.kind !== 'edge') return;
    change({
      ...docRef.current,
      edges: docRef.current.edges.map((e) =>
        e.id === selected.id ? { ...e, appearance: { ...e.appearance, ...patch } } : e,
      ),
    });
  }
  function updateNodeSize(axis: 'width' | 'height', value: number) {
    if (selected?.kind !== 'node') return;
    change({
      ...docRef.current,
      nodes: docRef.current.nodes.map((n) => {
        if (n.id !== selected.id) return n;
        const a = nodeAppearance(
          n,
          docRef.current.notation.nodeTypes.find((t) => t.id === n.typeId)!,
        );
        return { ...n, size: { width: a.width, height: a.height, [axis]: value } };
      }),
    });
  }
  function reorderNode(id: string, direction: 'front' | 'back' | 'forward' | 'backward') {
    const nodes = moveLayer(docRef.current.nodes, id, direction);
    if (nodes !== docRef.current.nodes) change({ ...docRef.current, nodes });
  }
  function adopt(result: ModelDiagram, record = true) {
    const next = projectDocument(result.document);
    mergeObjects(result.document.objects);
    mergeRelations(result.document.relations ?? []);
    change(next, record);
    setSavedDoc(JSON.stringify(next));
    revisionRef.current = result.revision;
    setRevision(result.revision);
    setBlocked(false);
    if (!next.notation.nodeTypes.some((t) => t.id === placementType))
      setPlacementType(next.notation.nodeTypes[0].id);
    if (!next.notation.edgeTypes.some((t) => t.id === edgeType))
      setEdgeType(next.notation.edgeTypes[0].id);
  }
  async function flush() {
    await objectWrites.current;
    if (JSON.stringify(docRef.current) === savedDoc) return true;
    return save();
  }
  async function addNode(
    typeId: string,
    objectId?: string,
    dropPosition?: { x: number; y: number },
    properties?: ModelObject['attributes'],
  ) {
    if (commandBusy || interacting) return;
    setPlacementType(typeId);
    const definition = docRef.current.notation.nodeTypes.find((t) => t.id === typeId)!;
    const existing = objectsRef.current.find((o) => o.id === objectId);
    const missing = definition.properties.filter((p) => {
      if (!p.required) return false;
      if (p.key === 'title' && p.type === 'string' && p.scope !== 'object') return false;
      const value =
        p.scope === 'object' && existing ? existing.attributes[p.objectKey ?? p.key] : p.default;
      return value === undefined || value === '' || typeof value !== p.type;
    });
    if (!properties && missing.length) {
      setPlacementRequest({
        typeId,
        objectId,
        position: dropPosition,
        values: Object.fromEntries(
          missing.map((p) => {
            const value =
              p.scope === 'object' && existing
                ? existing.attributes[p.objectKey ?? p.key]
                : p.default;
            return [
              p.key,
              typeof value === p.type
                ? value!
                : p.type === 'boolean'
                  ? false
                  : p.type === 'number'
                    ? 0
                    : '',
            ];
          }),
        ),
      });
      return;
    }
    const container = window.document.querySelector('.flow-container')!.getBoundingClientRect();
    const center = flow.screenToFlowPosition({
      x: container.left + container.width / 2,
      y: container.top + container.height / 2,
    });
    const { width, height } = definition.appearance;
    let position = { x: center.x - width / 2, y: center.y - height / 2 };
    for (let i = 0; i <= document.nodes.length * 5; i++) {
      const col = [0, 1, -1][i % 3],
        row = Math.floor(i / 3);
      position = {
        x:
          center.x -
          width / 2 +
          col *
            (Math.max(width, ...document.notation.nodeTypes.map((t) => t.appearance.width)) + 40),
        y:
          center.y -
          height / 2 +
          row *
            (Math.max(height, ...document.notation.nodeTypes.map((t) => t.appearance.height)) + 40),
      };
      const overlap = document.nodes.some((n) => {
        const a = nodeAppearance(
          n,
          document.notation.nodeTypes.find((t) => t.id === n.typeId)!,
        );
        return (
          position.x < n.position.x + a.width + 25 &&
          position.x + width + 25 > n.position.x &&
          position.y < n.position.y + a.height + 25 &&
          position.y + height + 25 > n.position.y
        );
      });
      if (!overlap) break;
    }
    if (dropPosition) position = dropPosition;
    setCommandBusy(true);
    try {
      if (!(await flush())) return;
      const shared = definition.properties.filter(
        (p) => p.scope === 'object' && properties?.[p.key] !== undefined,
      );
      if (objectId && shared.length) {
        const current = objectsRef.current.find((o) => o.id === objectId)!;
        mergeObjects([
          await api<ModelObject>(`objects/${objectId}`, 'PATCH', {
            revision: current.revision,
            incarnation: current.incarnation,
            attributes: {
              ...current.attributes,
              ...Object.fromEntries(shared.map((p) => [p.objectKey ?? p.key, properties![p.key]])),
            },
          }),
        ]);
      }
      const [bindingId, symbolId] = splitType(typeId);
      const before = new Set(docRef.current.nodes.map((n) => n.id));
      const result = await api<ModelDiagram>(`diagrams/${initial.id}/representations`, 'POST', {
        revision: revisionRef.current,
        bindingId,
        typeId: symbolId,
        objectId,
        position,
        properties: objectId
          ? Object.fromEntries(
              Object.entries(properties ?? {}).filter(
                ([key]) => definition.properties.find((p) => p.key === key)?.scope !== 'object',
              ),
            )
          : properties,
      });
      adopt(result);
      setPlacementRequest(null);
      const added = result.document.nodes.find((n) => !before.has(n.id));
      if (added) setSelected({ kind: 'node', id: added.id });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCommandBusy(false);
    }
  }
  function candidate(c: {
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }): DiagramDocument {
    const current = docRef.current;
    const typeId = connectionTypeForSource(current, c.source, edgeType, c.sourceHandle);
    const definition = current.notation.edgeTypes.find((t) => t.id === typeId);
    const values = defaults(definition?.properties ?? []);
    const relationId = crypto.randomUUID();
    const relation: ModelRelation = {
      id: relationId,
      sourceId: current.nodes.find((n) => n.id === c.source)!.objectId!,
      targetId: current.nodes.find((n) => n.id === c.target)!.objectId!,
      name: definition?.name ?? 'Связь',
      description: '',
      archived: false,
      revision: 1,
      attributes: Object.fromEntries(
        (definition?.properties ?? [])
          .filter((p) => p.scope === 'object' && values[p.key] !== undefined)
          .map((p) => [p.objectKey ?? p.key, values[p.key]]),
      ),
    };
    return {
      ...current,
      relations: [...(current.relations ?? []), relation],
      edges: [
        ...current.edges,
        {
          id: `edge-${crypto.randomUUID()}`,
          relationId,
          typeId,
          source: c.source,
          target: c.target,
          sourcePort: c.sourceHandle ?? '',
          targetPort: c.targetHandle ?? '',
          properties: Object.fromEntries(
            Object.entries(values).filter(
              ([key]) => definition?.properties.find((p) => p.key === key)?.scope !== 'object',
            ),
          ),
        },
      ],
    };
  }
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const fittedIds = useRef('');
  const nodeIds = document.nodes.map((n) => n.id).join(',');
  useEffect(() => {
    if (nodesInitialized && nodeIds !== fittedIds.current) {
      fittedIds.current = nodeIds;
      void flowRef.current.fitView({ padding: 0.25, maxZoom: 1, duration: 0 });
    }
  }, [nodesInitialized, nodeIds]);
  const nodeCache = useRef(new Map<string, ShapeNode>());
  const nodes = useMemo(() => {
    const result = document.nodes.map((n) => {
      const definition = document.notation.nodeTypes.find((t) => t.id === n.typeId)!;
      const isSelected = selected?.kind === 'node' && selected.id === n.id;
      const previous = nodeCache.current.get(n.id);
      if (
        previous?.data.node === n &&
        previous.data.definition === definition &&
        previous.data.shapes === document.notation.shapes &&
        previous.data.object === objectLookup.get(n.objectId ?? '') &&
        previous.selected === isSelected
      )
        return previous;
      const a = nodeAppearance(n, definition);
      const next: ShapeNode = {
        id: n.id,
        type: 'notation',
        position: n.position,
        width: a.width,
        height: a.height,
        style: { width: a.width, height: a.height },
        zIndex: n.layer ?? 0,
        data: {
          definition,
          node: n,
          shapes: document.notation.shapes,
          object: objectLookup.get(n.objectId ?? ''),
        },
        selected: isSelected,
      };
      nodeCache.current.set(n.id, next);
      return next;
    });
    const ids = new Set(document.nodes.map((n) => n.id));
    for (const id of nodeCache.current.keys()) if (!ids.has(id)) nodeCache.current.delete(id);
    return result;
  }, [document.nodes, document.notation, selected, objectLookup]);
  const styledEdges = useMemo(
    () =>
      document.edges.map((e) => ({
        id: e.id,
        appearance: edgeAppearance(
          document.notation.edgeTypes.find((t) => t.id === e.typeId)!.appearance,
          e.appearance,
        ),
      })),
    [document.edges, document.notation],
  );
  const edges = useMemo(
    () =>
      document.edges.map((e, i) => {
        const a = styledEdges[i].appearance;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourcePort,
          targetHandle: e.targetPort,
          type: a.routing === 'bezier' ? 'default' : a.routing,
          label: String(
            effectiveEdge(
              e,
              document.notation.edgeTypes.find((t) => t.id === e.typeId)!,
              relationLookup.get(e.relationId ?? ''),
            ).properties.label ?? '',
          ),
          selected: selected?.kind === 'edge' && selected.id === e.id,
          markerEnd: a.targetMarker === 'none' ? undefined : markerId(initial.id, e.id, 'end'),
          markerStart:
            (a.sourceMarker ?? 'none') === 'none' ? undefined : markerId(initial.id, e.id, 'start'),
          labelStyle: { fontSize: a.fontSize, fill: 'var(--text)' },
          labelBgStyle: { fill: 'var(--panel)' },
          style: {
            stroke: a.color,
            strokeWidth: a.width,
            strokeDasharray: lineDash(a),
            strokeLinecap: a.line === 'dotted' ? ('round' as const) : ('butt' as const),
          },
        };
      }),
    [
      document.edges,
      styledEdges,
      selected,
      initial.id,
      relationLookup,
      document.notation.edgeTypes,
    ],
  );
  function deleteItems(nodeIds: string[], edgeIds: string[]) {
    change({
      ...docRef.current,
      nodes: docRef.current.nodes.filter((n) => !nodeIds.includes(n.id)),
      edges: docRef.current.edges.filter(
        (e) =>
          !edgeIds.includes(e.id) && !nodeIds.includes(e.source) && !nodeIds.includes(e.target),
      ),
    });
    setSelected(null);
  }
  function nodesChanged(changes: NodeChange<ShapeNode>[]) {
    const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id);
    if (removed.length) {
      deleteItems(removed, []);
      return;
    }
    let changed = false;
    const updated = docRef.current.nodes.map((n) => {
      let next = n;
      for (const c of changes) {
        if (!('id' in c) || c.id !== n.id) continue;
        if (
          c.type === 'position' &&
          c.position &&
          (c.position.x !== n.position.x || c.position.y !== n.position.y)
        ) {
          next = { ...next, position: c.position };
          changed = true;
        }
        if (c.type === 'dimensions' && c.dimensions && c.setAttributes) {
          const a = nodeAppearance(
            next,
            docRef.current.notation.nodeTypes.find((t) => t.id === n.typeId)!,
          );
          if (a.width !== c.dimensions.width || a.height !== c.dimensions.height) {
            next = { ...next, size: { width: c.dimensions.width, height: c.dimensions.height } };
            changed = true;
          }
        }
      }
      return next;
    });
    if (changed) change({ ...docRef.current, nodes: updated }, false);
  }

  function edgesChanged(changes: EdgeChange[]) {
    const ids = changes.filter((c) => c.type === 'remove').map((c) => c.id);
    if (ids.length) deleteItems([], ids);
  }
  function undoAction() {
    if (!undo.length) return;
    const previous = undo[undo.length - 1];
    const current = structuredClone(docRef.current);
    setRedo((r) => [...r, current]);
    setUndo(undo.slice(0, -1));
    change(previous, false);
  }
  function redoAction() {
    if (!redo.length) return;
    const next = redo[redo.length - 1];
    const current = structuredClone(docRef.current);
    setUndo((u) => [...u, current]);
    setRedo(redo.slice(0, -1));
    change(next, false);
  }
  function locateRelation(id: string) {
    const edge = docRef.current.edges.find((e) => e.relationId === id);
    if (edge) {
      setSelected({ kind: 'edge', id: edge.id });
      void flow.fitView({
        nodes: [{ id: edge.source }, { id: edge.target }],
        padding: 0.3,
        maxZoom: 1,
      });
    } else {
      const r = relationLookup.get(id);
      if (r) void editRelation(r);
    }
  }
  async function editRelation(r?: ModelRelation) {
    try {
      if (r && !(await flush())) throw new Error('Сначала сохраните диаграмму');
      setRelationEditing(r ? (relationsRef.current.find((x) => x.id === r.id) ?? r) : 'new');
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const rawSelectedObject =
    selected?.kind === 'node'
      ? document.nodes.find((n) => n.id === selected.id)
      : selected?.kind === 'edge'
        ? document.edges.find((e) => e.id === selected.id)
        : undefined;
  const definition = rawSelectedObject
    ? selected?.kind === 'node'
      ? document.notation.nodeTypes.find((t) => t.id === rawSelectedObject.typeId)
      : document.notation.edgeTypes.find((t) => t.id === rawSelectedObject.typeId)
    : undefined;
  const selectedObject =
    rawSelectedObject && definition && selected?.kind === 'node'
      ? effectiveNode(
          rawSelectedObject as LegacyDocument['nodes'][number],
          definition as (typeof document.notation.nodeTypes)[number],
          objectLookup.get((rawSelectedObject as LegacyDocument['nodes'][number]).objectId ?? ''),
        )
      : rawSelectedObject && definition && selected?.kind === 'edge'
        ? effectiveEdge(
            rawSelectedObject as LegacyDocument['edges'][number],
            definition as (typeof document.notation.edgeTypes)[number],
            relationLookup.get(
              (rawSelectedObject as ViewDocument['edges'][number]).relationId ?? '',
            ),
          )
        : rawSelectedObject;
  const selectedNode =
    selected?.kind === 'node' ? document.nodes.find((n) => n.id === selected.id) : undefined;
  const selectedEdge =
    selected?.kind === 'edge' ? document.edges.find((e) => e.id === selected.id) : undefined;
  const selectedNodeCaption =
    selected?.kind === 'node' && selectedObject && definition
      ? nodeLabel(
          selectedObject as LegacyDocument['nodes'][number],
          definition as (typeof document.notation.nodeTypes)[number],
        )
      : undefined;
  const selectedNodeAppearance = selectedNode
    ? nodeAppearance(
        selectedNode,
        document.notation.nodeTypes.find((t) => t.id === selectedNode.typeId)!,
      )
    : undefined;
  function propertyChange(key: string, value: string | number | boolean) {
    if (!selected) return;
    const p = definition?.properties.find((p) => p.key === key);
    if (selected.kind === 'edge' && p?.scope === 'object') {
      const relationId = selectedEdge?.relationId;
      setObjectSaving(true);
      const operation = objectWrites.current
        .then(async () => {
          const r = relationsRef.current.find((r) => r.id === relationId);
          if (!r) {
            const current = docRef.current;
            const draft = current.relations?.find((x) => x.id === relationId);
            if (!draft) throw new Error('Связь модели не найдена');
            change({
              ...current,
              relations: current.relations?.map((x) =>
                x.id === relationId
                  ? { ...x, attributes: { ...x.attributes, [p.objectKey ?? p.key]: value } }
                  : x,
              ),
            });
            return true;
          }
          mergeRelations([
            await api<ModelRelation>(`relations/${r.id}`, 'PATCH', {
              revision: r.revision,
              incarnation: r.incarnation,
              attributes: { ...r.attributes, [p.objectKey ?? p.key]: value },
            }),
          ]);
          return true;
        })
        .catch((err) => {
          setError(err.message);
          return false;
        });
      objectWrites.current = operation;
      void operation.finally(() => {
        if (objectWrites.current === operation) setObjectSaving(false);
      });
      return operation;
    }
    if (selected.kind === 'node' && p?.scope === 'object') {
      const objectId = selectedNode?.objectId;
      setObjectSaving(true);
      const operation = objectWrites.current
        .then(async () => {
          const object = objectsRef.current.find((o) => o.id === objectId);
          if (!object) return;
          const updated = await api<ModelObject>(`objects/${object.id}`, 'PATCH', {
            revision: object.revision,
            incarnation: object.incarnation,
            attributes: { ...object.attributes, [p.objectKey ?? p.key]: value },
          });
          mergeObjects([updated]);
          return true;
        })
        .catch((err) => {
          setError(err.message);
          return false;
        });
      objectWrites.current = operation;
      void operation.finally(() => {
        if (objectWrites.current === operation) setObjectSaving(false);
      });
      return operation;
    }
    change({
      ...docRef.current,
      [selected.kind === 'node' ? 'nodes' : 'edges']: (selected.kind === 'node'
        ? docRef.current.nodes
        : docRef.current.edges
      ).map((x) =>
        x.id === selected.id
          ? {
              ...x,
              ...(selected.kind === 'node' && key === 'title' ? { label: undefined } : {}),
              properties: { ...x.properties, [key]: value },
            }
          : x,
      ),
    } as DiagramDocument);
  }
  function skinCandidate(
    nodeId: string,
    typeId: string,
    ports: Record<string, string>,
    types: Record<string, string>,
  ): ViewDocument {
    const current = docRef.current,
      definition = current.notation.nodeTypes.find((t) => t.id === typeId)!;
    return {
      ...current,
      nodes: current.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const cached = n.profiles?.[typeId] ?? n.properties;
        const properties: Record<string, string | number | boolean> = {};
        for (const p of definition.properties)
          if (p.scope !== 'object') {
            if (cached[p.key] !== undefined && typeof cached[p.key] === p.type)
              properties[p.key] = cached[p.key];
            else if (p.key !== 'title' && p.default !== undefined) properties[p.key] = p.default;
          }
        return {
          ...n,
          typeId,
          size: n.size ?? {
            width: nodeAppearance(
              n,
              current.notation.nodeTypes.find((t) => t.id === n.typeId)!,
            ).width,
            height: nodeAppearance(
              n,
              current.notation.nodeTypes.find((t) => t.id === n.typeId)!,
            ).height,
          },
          properties,
          profiles: { ...n.profiles, [n.typeId]: n.properties },
          appearance: n.appearance
            ? { ...n.appearance, shape: undefined, shapeId: undefined }
            : undefined,
        };
      }),
      edges: current.edges
        .filter((e) => types[e.id] !== 'delete')
        .map((e) => {
          if (e.source !== nodeId && e.target !== nodeId) return e;
          const newType = types[e.id] ?? e.typeId,
            t = current.notation.edgeTypes.find((t) => t.id === newType)!;
          const properties = Object.fromEntries(
            t.properties
              .map((p) => [
                p.key,
                typeof e.properties[p.key] === p.type ? e.properties[p.key] : p.default,
              ])
              .filter(([, v]) => v !== undefined),
          );
          return {
            ...e,
            typeId: newType,
            properties,
            sourcePort:
              e.source === nodeId ? (ports[`${e.id}:source`] ?? e.sourcePort) : e.sourcePort,
            targetPort:
              e.target === nodeId ? (ports[`${e.id}:target`] ?? e.targetPort) : e.targetPort,
          };
        }),
    };
  }
  function requestSkin(nodeId: string, typeId: string) {
    const definition = docRef.current.notation.nodeTypes.find((t) => t.id === typeId)!,
      ports: Record<string, string> = {},
      types: Record<string, string> = {};
    for (const e of docRef.current.edges.filter(
      (e) => e.source === nodeId || e.target === nodeId,
    )) {
      types[e.id] = e.typeId;
      if (e.source === nodeId)
        ports[`${e.id}:source`] = definition.ports.some(
          (p) => p.id === e.sourcePort && p.direction === 'output',
        )
          ? e.sourcePort
          : '';
      if (e.target === nodeId)
        ports[`${e.id}:target`] = definition.ports.some(
          (p) => p.id === e.targetPort && p.direction === 'input',
        )
          ? e.targetPort
          : '';
    }
    const next = skinCandidate(nodeId, typeId, ports, types),
      issues = modelErrors(packDocument(next, objectsRef.current, relationsRef.current));
    if (issues.length) setSkinChange({ nodeId, typeId, ports, types });
    else change(next);
  }
  async function updateNotations(notationId?: string, removeBindingId?: string) {
    setCommandBusy(true);
    try {
      if (!(await flush())) return;
      adopt(
        await api<ModelDiagram>(`diagrams/${initial.id}/notations`, 'POST', {
          revision: revisionRef.current,
          notationId,
          removeBindingId,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCommandBusy(false);
    }
  }
  async function showHistory() {
    try {
      setRevisions(await api(`diagrams/${initial.id}/revisions`));
      setHistoryOpen(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <main className={`editor ${commandBusy || objectSaving ? 'remote-busy' : ''}`}>
      <div className="editor-toolbar">
        <div className="editor-title">
          <Link href="/library" className="icon-button" aria-label="В библиотеку">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <button
              className="title-button"
              onClick={async () => {
                const next = prompt('Название диаграммы', name);
                if (!next?.trim()) return;
                try {
                  const result = await api<Diagram>(`diagrams/${initial.id}`, 'PATCH', {
                    name: next,
                  });
                  setName(result.name);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {name}
              <ChevronDown size={14} />
            </button>
            <small>
              {document.notation.name} · v{document.notation.version}
            </small>
          </div>
        </div>
        <div className="editor-save-state">
          {saving ? (
            'Сохраняем…'
          ) : dirty ? (
            <>
              <span className="unsaved-dot" />
              Есть изменения
            </>
          ) : (
            <>
              <CheckCircle2 size={14} />
              Сохранено · ревизия {revision}
            </>
          )}
        </div>
        <div className="button-row">
          <button
            className="icon-button"
            title="Отменить"
            aria-label="Отменить"
            disabled={commandBusy || interacting || !undo.length}
            onClick={undoAction}
          >
            <Undo2 size={18} />
          </button>
          <button
            className="icon-button"
            title="Повторить"
            aria-label="Повторить"
            disabled={commandBusy || interacting || !redo.length}
            onClick={redoAction}
          >
            <Redo2 size={18} />
          </button>
          <span className="toolbar-divider" />
          <button className="secondary small" onClick={showHistory}>
            <History size={16} />
            История
          </button>
          <button
            className="secondary small"
            onClick={() =>
              download(`${name}.maket.json`, {
                name,
                document: packDocument(docRef.current, objectsRef.current, relationsRef.current),
              })
            }
          >
            <Download size={16} />
            Экспорт
          </button>
          <button
            className="primary small"
            onClick={() => void save(true)}
            disabled={commandBusy || objectSaving || interacting || saving || (!dirty && !blocked)}
          >
            <Save size={16} />
            {blocked ? 'Повторить' : 'Сохранить'}
          </button>
        </div>
      </div>
      {error && (
        <div className="error editor-error" role="alert">
          {error}
        </div>
      )}
      <div className="editor-body model-editor-body">
        <ObjectTree
          objects={objects}
          relations={allRelations}
          onRelationLocate={locateRelation}
          onRelationEdit={(r) => void editRelation(r)}
          relationsPanel={
            <RelationBrowser
              relations={allRelations}
              objects={objects}
              counts={
                new Map(
                  allRelations.map((r) => [
                    r.id,
                    document.edges.filter((e) => e.relationId === r.id).length,
                  ]),
                )
              }
              onEdit={(r) => void editRelation(r)}
              onLocate={locateRelation}
              onPlace={(r) => setRelationPlacement(r)}
              onSaved={(r) => mergeRelations([r])}
              onBeforeWrite={async () => {
                if (!(await flush())) throw new Error('Сначала сохраните диаграмму');
              }}
              onRemove={async (r) => {
                setCommandBusy(true);
                try {
                  if (!(await flush())) throw new Error('Сначала завершите сохранение диаграммы');
                  const current = relationsRef.current.find((x) => x.id === r.id) ?? r;
                  await api(`relations/${r.id}`, 'DELETE', {
                    revision: current.revision,
                    incarnation: current.incarnation,
                  });
                  mergeRelations(
                    relationsRef.current.filter((x) => x.id !== r.id),
                    true,
                  );
                } finally {
                  setCommandBusy(false);
                }
              }}
            />
          }

          counts={
            new Map(
              objects.map((o) => [o.id, document.nodes.filter((n) => n.objectId === o.id).length]),
            )
          }
          selectedId={selectedNode?.objectId}
          onSaved={(o) => mergeObjects([o])}
          onRefresh={() => void refreshObjects()}
          onRemove={async (o) => {
            setCommandBusy(true);
            try {
              if (!(await flush()))
                throw new Error('Сначала завершите сохранение диаграммы, затем повторите удаление');
              await api(`objects/${o.id}`, 'DELETE', {
                revision: o.revision,
                incarnation: o.incarnation,
              });
              mergeObjects(
                objectsRef.current.filter((x) => x.id !== o.id),
                true,
              );
            } finally {
              setCommandBusy(false);
            }
          }}
          onPlace={(id) => void addNode(placementType, id)}
          onLocate={(id) => {
            const n = docRef.current.nodes.find((n) => n.objectId === id);
            if (n) {
              setSelected({ kind: 'node', id: n.id });
              void flow.fitView({
                nodes: docRef.current.nodes
                  .filter((n) => n.objectId === id)
                  .map((n) => ({ id: n.id })),
                padding: 0.5,
                maxZoom: 1,
              });
            } else {
              const o = objectLookup.get(id);
              if (o) setObjectEditing(o);
            }
          }}
        />

        <aside className="palette">
          <div className="palette-title">
            <h3>Инструменты</h3>
            <span className="badge">{document.notation.nodeTypes.length}</span>
          </div>
          <p className="muted small-text">Нажмите, чтобы добавить элемент</p>
          <button
            className="secondary wide small"
            onClick={async () => {
              try {
                setAvailableNotations(await api<NotationItem[]>('notations'));
                setNotationsOpen(true);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            Нотации диаграммы
          </button>
          <label className="small-text">
            Отображение при размещении
            <select
              aria-label="Отображение при размещении"
              value={placementType}
              onChange={(e) => setPlacementType(e.target.value)}
            >
              {document.bindings.map((b) => (
                <optgroup label={b.document.name} key={b.id}>
                  {b.document.nodeTypes.map((t) => (
                    <option value={qualify(b.id, t.id)} key={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {document.bindings.map((b) => (
            <section
              className="notation-palette-section"
              key={b.id}
              aria-label={`Палитра ${b.document.name}`}
            >
              <div className="palette-section">
                {b.document.name} · {b.document.version}
              </div>
              {b.document.nodeTypes.map((t) => (
                <button
                  className="palette-item"
                  key={t.id}
                  disabled={commandBusy}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/maket-type', qualify(b.id, t.id));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => void addNode(qualify(b.id, t.id))}
                >
                  <span
                    className={`palette-shape ${t.appearance.shape}`}
                    style={{ borderColor: t.appearance.stroke, background: t.appearance.fill }}
                  />
                  <span>{t.name}</span>
                  <Plus size={14} />
                </button>
              ))}
            </section>
          ))}
          <div className="palette-section">СОЕДИНЕНИЯ</div>
          <label className="small-text">
            Тип связи
            <select
              value={edgeType}
              onChange={(e) => setEdgeType(e.target.value)}
              aria-label="Тип связи"
            >
              {document.bindings.map((b) => (
                <optgroup label={b.document.name} key={b.id}>
                  {b.document.edgeTypes.map((t) => (
                    <option value={qualify(b.id, t.id)} key={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ))}
              <optgroup label="Пояснения">
                <option value="universal:association">Поясняющая связь</option>
              </optgroup>
            </select>
          </label>
          <p className="muted small-text">
            Перетащите связь от правого порта к левому. Тип связи выбирается в нотации исходного
            представления. Соединение должно соответствовать её правилам.
          </p>
          <div className="palette-section">СЛОИ</div>
          <div className="layers-panel" aria-label="Слои диаграммы">
            {[...document.nodes]
              .sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0))
              .reverse()
              .map((n) => (
                <button
                  className={selected?.kind === 'node' && selected.id === n.id ? 'selected' : ''}
                  key={n.id}
                  onClick={() => setSelected({ kind: 'node', id: n.id })}
                >
                  <span>
                    {String(
                      n.label ??
                        n.properties.title ??
                        document.notation.nodeTypes.find((t) => t.id === n.typeId)?.name,
                    )}
                  </span>
                  <small>{n.layer ?? 0}</small>
                </button>
              ))}
            {!document.nodes.length && <span className="muted small-text">Пока нет элементов</span>}
          </div>
          <div className="palette-bottom">
            <input
              type="file"
              hidden
              ref={file}
              accept=".json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  const raw = await readJson(f),
                    parsed = portableDiagramSchema.parse(raw.document ?? raw);
                  if (parsed.schemaVersion !== 2 || parsed.modelSpaceId !== document.modelSpaceId)
                    throw new Error('Импортируйте этот файл как новую диаграмму через библиотеку.');
                  if (JSON.stringify(parsed.bindings) !== JSON.stringify(document.bindings))
                    throw new Error('Другой набор нотаций. Используйте импорт через библиотеку.');
                  if (parsed.nodes.some((n) => !objectLookup.has(n.objectId)))
                    throw new Error('Объекты файла отсутствуют в модели. Используйте библиотеку.');
                  const next = packDocument(
                    projectDocument(parsed),
                    objectsRef.current,
                    relationsRef.current,
                  );
                  const issues = modelErrors(next);
                  if (issues.length) throw new Error(issues.join('; '));
                  change(projectDocument(next));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
            <button className="secondary wide small" onClick={() => file.current?.click()}>
              <Upload size={15} />
              Импорт файла
            </button>
            <span className="muted small-text">
              Удалить: Backspace / Delete
              <br />
              Перемещение: перетаскивание
              <br />
              Масштаб: колесо мыши
            </span>
          </div>
        </aside>
        <div
          className="flow-container"
          onDragOver={(e) => {
            if (
              e.dataTransfer.types.some(
                (t) => t === 'application/maket-object' || t === 'application/maket-type',
              )
            ) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            const objectId = e.dataTransfer.getData('application/maket-object'),
              typeId = e.dataTransfer.getData('application/maket-type');
            if (objectId || typeId)
              void addNode(
                typeId || placementType,
                objectId || undefined,
                flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
              );
          }}
        >
          <NodeActionsContext.Provider value={nodeActions}>
            <ReactFlow<ShapeNode>
              nodes={nodes}
              edges={edges}
              nodeTypes={diagramNodeTypes}
              colorMode={user.settings.theme}
              elevateNodesOnSelect={false}
              elevateEdgesOnSelect={false}
              onNodesChange={nodesChanged}
              onEdgesChange={edgesChanged}
              onNodeClick={(_, n) => setSelected({ kind: 'node', id: n.id })}
              onEdgeClick={(_, e) => setSelected({ kind: 'edge', id: e.id })}
              onPaneClick={() => setSelected(null)}
              onNodeDragStart={() => beginGesture('drag')}
              onNodeDragStop={endGesture}
              onConnectStart={(_, { nodeId, handleId, handleType }) => {
                if (nodeId && handleType === 'source')
                  setEdgeType(connectionTypeForSource(docRef.current, nodeId, edgeType, handleId));
              }}
              onConnect={(c) => {
                const next = candidate(c);
                const issues = modelErrors(
                  packDocument(next, objectsRef.current, relationsRef.current),
                );
                if (issues.length) setError(issues.join('; '));
                else {
                  setEdgeType(next.edges[next.edges.length - 1].typeId);
                  change(next);
                }
              }}
              isValidConnection={(c) =>
                modelErrors(packDocument(candidate(c), objectsRef.current, relationsRef.current))
                  .length === 0
              }
              snapToGrid={user.settings.snapToGrid}
              snapGrid={[20, 20]}
              deleteKeyCode={commandBusy || objectSaving ? null : ['Backspace', 'Delete']}
              minZoom={0.2}
              maxZoom={2}
            >
              <EdgeMarkers diagramId={initial.id} edges={styledEdges} />
              <Background
                variant={BackgroundVariant.Dots}
                gap={20}
                size={1}
                color="var(--canvas-dots)"
              />
              <Controls showInteractive={false} />
              <MiniMap
                pannable
                maskColor="var(--minimap-mask)"
                bgColor="var(--panel)"
                zoomable
                nodeColor={(n) =>
                  nodeAppearance((n.data as ShapeData).node, (n.data as ShapeData).definition).fill
                }
                nodeStrokeColor={(n) =>
                  nodeAppearance((n.data as ShapeData).node, (n.data as ShapeData).definition)
                    .stroke
                }
              />
            </ReactFlow>
          </NodeActionsContext.Provider>
          {!document.nodes.length && (
            <div className="canvas-empty">
              <span>
                <GitBranch size={30} />
              </span>
              <h2>Всё начинается с одного элемента</h2>
              <p>
                Выберите инструмент в палитре слева
                <br />и создайте первую связь.
              </p>
            </div>
          )}
          <div className="canvas-caption">
            <MousePointer2 size={13} /> {document.nodes.length} элементов · {document.edges.length}{' '}
            связей
          </div>
        </div>
        <aside className="inspector">
          <h3>Свойства</h3>
          {selectedObject && definition ? (
            <>
              <div className="inspector-type">
                <span className="file-icon">
                  <GitBranch size={20} />
                </span>
                <div>
                  <strong>{selectedNodeCaption ?? definition.name}</strong>
                  <small>{selected?.kind === 'node' ? definition.name : 'Соединение'}</small>
                </div>
              </div>
              {selectedNode?.objectId && objectLookup.get(selectedNode.objectId) && (
                <div className="model-object-summary">
                  <strong>{objectLookup.get(selectedNode.objectId)!.name}</strong>
                  <small>
                    Общий объект ·{' '}
                    {document.nodes.filter((n) => n.objectId === selectedNode.objectId).length}{' '}
                    представлений здесь
                  </small>
                  <button
                    className="secondary small"
                    onClick={() => setObjectEditing(objectLookup.get(selectedNode.objectId!)!)}
                  >
                    Общие свойства объекта
                  </button>
                  <button
                    className="secondary small"
                    onClick={() => void addNode(selectedNode.typeId, selectedNode.objectId)}
                  >
                    Ещё одно представление
                  </button>
                  <button
                    className="secondary small"
                    disabled={
                      selectedNode.label === undefined &&
                      selectedNode.properties.title === undefined
                    }
                    onClick={() =>
                      change({
                        ...docRef.current,
                        nodes: docRef.current.nodes.map((n) => {
                          if (n.id !== selectedNode.id) return n;
                          const properties = { ...n.properties };
                          if (
                            definition.properties.some(
                              (p) =>
                                p.key === 'title' && p.type === 'string' && p.scope !== 'object',
                            )
                          )
                            delete properties.title;
                          return { ...n, label: undefined, properties };
                        }),
                      })
                    }
                  >
                    Сбросить локальную подпись
                  </button>
                  <label>
                    Отображение объекта
                    <select
                      aria-label="Отображение объекта"
                      value={selectedNode.typeId}
                      onChange={(e) => requestSkin(selectedNode.id, e.target.value)}
                    >
                      {document.bindings.map((b) => (
                        <optgroup label={`${b.document.name} · ${b.document.version}`} key={b.id}>
                          {b.document.nodeTypes.map((t) => (
                            <option key={t.id} value={qualify(b.id, t.id)}>
                              {t.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              <div className="form-stack">
                {definition.properties.map((p) => (
                  <label key={p.key}>
                    {p.label}
                    {p.scope === 'object' && <small> · общий атрибут</small>}
                    {p.required && <span className="required"> *</span>}
                    {p.type === 'boolean' ? (
                      <PropertyCheckbox
                        key={`${selected?.id}:${p.key}`}
                        value={Boolean(selectedObject.properties[p.key])}
                        onValue={(value) => propertyChange(p.key, value)}
                      />
                    ) : (
                      <PropertyInput
                        key={`${selected?.id}:${p.key}`}
                        shared={p.scope === 'object' && selected?.kind === 'node'}
                        type={p.type === 'number' ? 'number' : 'text'}
                        value={
                          selectedNodeCaption !== undefined &&
                          p.key === 'title' &&
                          p.type === 'string' &&
                          p.scope !== 'object'
                            ? selectedNodeCaption
                            : String(selectedObject.properties[p.key] ?? '')
                        }
                        onValue={(value) =>
                          propertyChange(p.key, p.type === 'number' ? Number(value) : value)
                        }
                      />
                    )}
                  </label>
                ))}
                {!definition.properties.length && (
                  <p className="muted">У этого типа нет дополнительных свойств.</p>
                )}
              </div>
              {selectedNode && selectedNodeAppearance && (
                <div className="inspector-appearance form-stack">
                  <h3>Размер и слои</h3>
                  <div className="appearance-grid">
                    <NumberField
                      label="Ширина объекта"
                      value={selectedNodeAppearance.width}
                      min={40}
                      max={2000}
                      onChange={(v) => updateNodeSize('width', v)}
                    />
                    <NumberField
                      label="Высота объекта"
                      value={selectedNodeAppearance.height}
                      min={30}
                      max={1600}
                      onChange={(v) => updateNodeSize('height', v)}
                    />
                  </div>
                  <NumberField
                    label="Уровень слоя"
                    value={selectedNode.layer ?? 0}
                    min={-1000000}
                    max={1000000}
                    onChange={(layer) =>
                      change({
                        ...docRef.current,
                        nodes: docRef.current.nodes.map((n) =>
                          n.id === selectedNode.id ? { ...n, layer: Math.round(layer) } : n,
                        ),
                      })
                    }
                  />
                  <div className="layer-actions">
                    <button
                      className="secondary small"
                      onClick={() => reorderNode(selectedNode.id, 'front')}
                    >
                      На передний план
                    </button>
                    <button
                      className="secondary small"
                      onClick={() => reorderNode(selectedNode.id, 'back')}
                    >
                      На задний план
                    </button>
                    <button
                      className="secondary small"
                      onClick={() => reorderNode(selectedNode.id, 'forward')}
                    >
                      На уровень выше
                    </button>
                    <button
                      className="secondary small"
                      onClick={() => reorderNode(selectedNode.id, 'backward')}
                    >
                      На уровень ниже
                    </button>
                  </div>
                  <h3>Оформление объекта</h3>
                  <label>
                    Форма объекта
                    <select
                      aria-label="Форма объекта"
                      value={
                        selectedNodeAppearance.shape === 'custom'
                          ? `custom:${selectedNodeAppearance.shapeId}`
                          : selectedNodeAppearance.shape
                      }
                      onChange={(e) =>
                        updateNodeAppearance(
                          e.target.value.startsWith('custom:')
                            ? { shape: 'custom', shapeId: e.target.value.slice(7) }
                            : {
                                shape: e.target.value as NodeOverride['shape'],
                                shapeId: undefined,
                              },
                        )
                      }
                    >
                      {baseShapes.map((shape, i) => (
                        <option value={shape} key={shape}>
                          {['Прямоугольник', 'Скруглённый', 'Ромб', 'Эллипс', 'Текст'][i]}
                        </option>
                      ))}
                      {document.notation.shapes
                        ?.filter((s) => splitType(s.id)[0] === splitType(selectedNode.typeId)[0])
                        .map((s) => (
                          <option value={`custom:${s.id}`} key={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="appearance-grid">
                    <label>
                      Заливка объекта
                      <input
                        type="color"
                        aria-label="Заливка объекта"
                        value={selectedNodeAppearance.fill}
                        onChange={(e) => updateNodeAppearance({ fill: e.target.value })}
                      />
                    </label>
                    <label>
                      Контур объекта
                      <input
                        type="color"
                        aria-label="Контур объекта"
                        value={selectedNodeAppearance.stroke}
                        onChange={(e) => updateNodeAppearance({ stroke: e.target.value })}
                      />
                    </label>
                  </div>
                  <TextAppearanceControls
                    value={selectedNodeAppearance}
                    onChange={updateNodeAppearance}
                  />
                  <small className="muted">
                    Двойной щелчок — изменить текст. Enter — сохранить, Esc — отменить.
                  </small>
                </div>
              )}
              {selectedEdge && (
                <div className="inspector-appearance form-stack">
                  <h3>Связь модели</h3>
                  <p className="small-text">
                    {relationLookup.get(selectedEdge.relationId ?? '')?.name ?? 'Связь'} · общая для
                    всех стрелок
                  </p>
                  <button
                    className="secondary small"
                    onClick={() => {
                      const r = relationLookup.get(selectedEdge.relationId ?? '');
                      if (r) void editRelation(r);
                    }}
                  >
                    Общие свойства связи
                  </button>
                  <label>
                    Использовать связь модели
                    <select
                      aria-label="Использовать связь модели"
                      value={selectedEdge.relationId ?? ''}
                      onChange={(e) =>
                        change({
                          ...docRef.current,
                          edges: docRef.current.edges.map((x) =>
                            x.id === selectedEdge.id ? { ...x, relationId: e.target.value } : x,
                          ),
                        })
                      }
                    >
                      {allRelations
                        .filter(
                          (r) =>
                            (!r.archived || r.id === selectedEdge.relationId) &&
                            r.sourceId ===
                              document.nodes.find((n) => n.id === selectedEdge.source)?.objectId &&
                            r.targetId ===
                              document.nodes.find((n) => n.id === selectedEdge.target)?.objectId,
                        )
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <h3>Оформление стрелки</h3>
                  <EdgeAppearanceControls
                    value={edgeAppearance(
                      document.notation.edgeTypes.find((t) => t.id === selectedEdge.typeId)!
                        .appearance,
                      selectedEdge.appearance,
                    )}
                    onChange={updateEdgeAppearance}
                  />
                </div>
              )}
              <div className="inspector-meta">
                <small>ID</small>
                <code>{selectedObject.id.slice(0, 22)}…</code>
              </div>
              <button
                className="secondary danger wide small"
                onClick={() =>
                  deleteItems(
                    selected?.kind === 'node' ? [selected.id] : [],
                    selected?.kind === 'edge' ? [selected.id] : [],
                  )
                }
              >
                <Trash2 size={15} />
                Удалить {selected?.kind === 'node' ? 'элемент' : 'связь'}
              </button>
            </>
          ) : (
            <div className="inspector-empty">
              <MousePointer2 size={26} />
              <p>
                Выберите элемент или связь,
                <br />
                чтобы изменить свойства.
              </p>
            </div>
          )}
          <div className="validation-box">
            <strong>
              {errors.length ? (
                <>
                  <AlertCircle size={15} />
                  {errors.length} ошибок
                </>
              ) : (
                <>
                  <CheckCircle2 size={15} />
                  Диаграмма корректна
                </>
              )}
            </strong>
            {errors.map((error, i) => (
              <p key={i}>{error}</p>
            ))}
            <small>Проверка по правилам нотации</small>
          </div>
        </aside>
      </div>
      {historyOpen && (
        <Modal title="История диаграммы" onClose={() => setHistoryOpen(false)}>
          <p className="muted">Последние 100 сохранений. Восстановление создаёт новую ревизию.</p>
          <div className="revision-list">
            {revisions.map((r) => (
              <div className="revision-row" key={r.number}>
                <div>
                  <strong>
                    Ревизия {r.number}
                    {r.number === revision && <span className="badge">Текущая</span>}
                  </strong>
                  <small>
                    {date(r.createdAt)} ·{' '}
                    {r.reason === 'restore'
                      ? 'Восстановление'
                      : r.reason === 'create'
                        ? 'Создание'
                        : r.reason === 'duplicate'
                          ? 'Копирование'
                          : 'Сохранение'}
                  </small>
                </div>
                <button
                  className="secondary small"
                  onClick={async () => {
                    try {
                      const d = await api<{ document: ModelDocument | LegacyDocument }>(
                        `diagrams/${initial.id}/history?number=${r.number}`,
                      );
                      setHistorical(d.document);
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                >
                  Просмотреть снимок
                </button>
                <button
                  className="secondary small"
                  disabled={commandBusy || r.number === revision || saving}
                  onClick={async () => {
                    if (
                      !confirm('Восстановить эту версию? Несохранённые изменения будут потеряны.')
                    )
                      return;
                    try {
                      const d = await api<ModelDiagram>(`diagrams/${initial.id}/restore`, 'POST', {
                        revision: revisionRef.current,
                        number: r.number,
                      });
                      adopt(d);
                      setHistoryOpen(false);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Восстановить
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {relationEditing && (
        <RelationEditor
          key={
            relationEditing === 'new' ? 'new' : `${relationEditing.id}:${relationEditing.revision}`
          }
          relation={relationEditing === 'new' ? undefined : relationEditing}
          objects={objects}
          onSaved={(r) => mergeRelations([r])}
          onClose={() => setRelationEditing(null)}
        />
      )}
      {relationPlacement && (
        <RelationPlacement
          relation={relationPlacement}
          document={document}
          onClose={() => setRelationPlacement(null)}
          onPlace={async (edge) => {
            if (!(await flush())) throw new Error('Сначала сохраните диаграмму');
            const next = {
              ...docRef.current,
              edges: [...docRef.current.edges, edge],
              relations: mergeModelObjects(docRef.current.relations ?? [], [relationPlacement]),
            };
            const issues = modelErrors(
              packDocument(next, objectsRef.current, relationsRef.current),
            );
            if (issues.length) throw new Error(issues.join('; '));
            change(next);
            setSelected({ kind: 'edge', id: edge.id });
          }}
        />
      )}
      {objectEditing && (
        <ObjectEditor
          key={`${objectEditing.id}:${objectEditing.revision}`}
          object={objectEditing}
          objects={objects}
          onSaved={(o) => mergeObjects([o])}
          onClose={() => setObjectEditing(null)}
        />
      )}
      {notationsOpen && (
        <Modal title="Нотации диаграммы" onClose={() => setNotationsOpen(false)}>
          <p className="muted">
            Каждая нотация закреплена на выбранной версии. Подключено {document.bindings.length} из
            12.
          </p>
          <div className="notation-bindings">
            {document.bindings.map((b) => (
              <div className="revision-row" key={b.id}>
                <span>
                  <strong>{b.document.name}</strong>
                  <small>v{b.document.version}</small>
                </span>
                <button
                  className="secondary small danger"
                  disabled={
                    commandBusy ||
                    document.bindings.length === 1 ||
                    document.nodes.some((n) => splitType(n.typeId)[0] === b.id) ||
                    document.edges.some((e) => splitType(e.typeId)[0] === b.id)
                  }
                  onClick={() => void updateNotations(undefined, b.id)}
                >
                  Отключить {b.document.name}
                </button>
              </div>
            ))}
          </div>
          <h3>Добавить из библиотеки</h3>
          {availableNotations.map((n) => (
            <button
              key={n.id}
              className="secondary notation-add"
              disabled={
                commandBusy ||
                document.bindings.length >= 12 ||
                document.bindings.some(
                  (b) =>
                    b.document.id === n.document.id && b.document.version === n.document.version,
                )
              }
              onClick={() => void updateNotations(n.id)}
            >
              Добавить {n.name} · v{n.document.version}
            </button>
          ))}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
        </Modal>
      )}
      {placementRequest && (
        <Modal title="Свойства перед размещением" onClose={() => setPlacementRequest(null)}>
          <p className="muted">
            Заполните обязательные свойства отображения. Общие атрибуты относятся к объекту и
            применяются ко всем его представлениям.
          </p>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void addNode(
                placementRequest.typeId,
                placementRequest.objectId,
                placementRequest.position,
                placementRequest.values,
              );
            }}
          >
            {Object.entries(placementRequest.values).map(([key, value]) => {
              const p = document.notation.nodeTypes
                .find((t) => t.id === placementRequest.typeId)!
                .properties.find((p) => p.key === key)!;
              return (
                <label key={key}>
                  {p.label}
                  {p.scope === 'object' && <small> · общий атрибут ({p.objectKey ?? p.key})</small>}
                  <input
                    type={
                      p.type === 'boolean' ? 'checkbox' : p.type === 'number' ? 'number' : 'text'
                    }
                    required={p.type !== 'boolean'}
                    maxLength={2000}
                    disabled={commandBusy}
                    checked={p.type === 'boolean' ? Boolean(value) : undefined}
                    value={p.type === 'boolean' ? undefined : String(value)}
                    onChange={(e) =>
                      setPlacementRequest({
                        ...placementRequest,
                        values: {
                          ...placementRequest.values,
                          [key]:
                            p.type === 'boolean'
                              ? e.target.checked
                              : p.type === 'number'
                                ? Number(e.target.value)
                                : e.target.value,
                        },
                      })
                    }
                  />
                </label>
              );
            })}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={commandBusy}>
              Разместить объект
            </button>
          </form>
        </Modal>
      )}
      {skinChange && (
        <Modal title="Изменить отображение объекта" onClose={() => setSkinChange(null)}>
          <p className="muted">
            Объект, размер и положение сохраняются. Сопоставьте порты и выберите совместимые связи.
            Прежние локальные свойства сохраняются для возврата к прежнему отображению.
          </p>
          <div className="skin-preview" aria-label="Предпросмотр нового отображения">
            <DiagramPreview
              document={displayedView(
                skinCandidate(
                  skinChange.nodeId,
                  skinChange.typeId,
                  skinChange.ports,
                  skinChange.types,
                ),
                objects,
              )}
            />
          </div>
          {docRef.current.edges
            .filter((e) => e.source === skinChange.nodeId || e.target === skinChange.nodeId)
            .map((e) => (
              <fieldset className="skin-edge-map" key={e.id}>
                <legend>{String(e.properties.label || e.id)}</legend>
                <label>
                  Отображение связи
                  <select
                    aria-label={`Отображение связи ${e.id}`}
                    value={skinChange.types[e.id]}
                    onChange={(ev) =>
                      setSkinChange({
                        ...skinChange,
                        types: { ...skinChange.types, [e.id]: ev.target.value },
                      })
                    }
                  >
                    {document.notation.edgeTypes.map((t) => (
                      <option value={t.id} key={t.id}>
                        {t.name}
                      </option>
                    ))}
                    <option value="delete">Удалить эту связь</option>
                  </select>
                </label>
                {(['source', 'target'] as const)
                  .filter((end) => (end === 'source' ? e.source : e.target) === skinChange.nodeId)
                  .map((end) => (
                    <label key={end}>
                      {end === 'source' ? 'Выходной' : 'Входной'} порт
                      <select
                        aria-label={`${end === 'source' ? 'Выходной' : 'Входной'} порт ${e.id}`}
                        value={skinChange.ports[`${e.id}:${end}`]}
                        onChange={(ev) =>
                          setSkinChange({
                            ...skinChange,
                            ports: { ...skinChange.ports, [`${e.id}:${end}`]: ev.target.value },
                          })
                        }
                      >
                        <option value="">Выберите порт</option>
                        {document.notation.nodeTypes
                          .find((t) => t.id === skinChange.typeId)!
                          .ports.filter(
                            (p) => p.direction === (end === 'source' ? 'output' : 'input'),
                          )
                          .map((p) => (
                            <option value={p.id} key={p.id}>
                              {p.id}
                            </option>
                          ))}
                      </select>
                    </label>
                  ))}
              </fieldset>
            ))}
          {modelErrors(
            packDocument(
              skinCandidate(
                skinChange.nodeId,
                skinChange.typeId,
                skinChange.ports,
                skinChange.types,
              ),
              objects,
              relations,
            ),
          ).map((issue, i) => (
            <p className="error" key={i}>
              {issue}
            </p>
          ))}
          <button
            className="primary"
            disabled={
              !!modelErrors(
                packDocument(
                  skinCandidate(
                    skinChange.nodeId,
                    skinChange.typeId,
                    skinChange.ports,
                    skinChange.types,
                  ),
                  objects,
                  relations,
                ),
              ).length
            }
            onClick={() => {
              change(
                skinCandidate(
                  skinChange.nodeId,
                  skinChange.typeId,
                  skinChange.ports,
                  skinChange.types,
                ),
              );
              setSkinChange(null);
            }}
          >
            Применить отображение
          </button>
        </Modal>
      )}
      {historical && (
        <Modal title="Снимок диаграммы" onClose={() => setHistorical(null)}>
          <p className="muted">
            Объекты показаны в состоянии на момент сохранения. Восстановление диаграммы использует
            актуальные общие данные модели.
          </p>
          <div className="history-preview">
            <DiagramPreview
              document={
                historical.schemaVersion === 2
                  ? displayedView(projectDocument(historical), historical.objects)
                  : historical
              }
            />
          </div>
          {historical.schemaVersion === 2 && (
            <ul>
              {historical.objects.map((o) => (
                <li key={o.id}>
                  {o.name} · версия объекта {o.revision}
                </li>
              ))}
            </ul>
          )}
          <button
            className="secondary"
            onClick={() => download(`${name}-history.maket.json`, { name, document: historical })}
          >
            Экспорт снимка
          </button>
        </Modal>
      )}
    </main>
  );
}

// Shared fields commit on blur so typing creates one object revision.
function PropertyInput({
  value,
  type,
  shared,
  onValue,
}: {
  value: string;
  type: 'text' | 'number';
  shared: boolean;
  onValue: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <input
      type={type}
      value={shared ? draft : value}
      maxLength={2000}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        if (!shared) onValue(e.target.value);
      }}
      onBlur={() => {
        focused.current = false;
        if (shared && draft !== value) onValue(draft);
      }}
      onKeyDown={(e) => {
        if (shared && e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function PropertyCheckbox({
  value,
  onValue,
}: {
  value: boolean;
  onValue: (value: boolean) => void | Promise<boolean | void>;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      type="checkbox"
      checked={draft}
      onChange={async (e) => {
        const checked = e.target.checked;
        setDraft(checked);
        if ((await onValue(checked)) === false) setDraft(value);
      }}
    />
  );
}
