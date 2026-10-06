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
import {
  type DiagramDocument,
  defaults,
  diagramErrors,
  diagramSchema,
} from '@/lib/notation';
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
  edgeAppearance,
  lineDash,
  moveLayer,
  baseShapes,
  type NodeOverride,
  type EdgeOverride,
} from '@/lib/appearance';
type Diagram = { id: string; name: string; revision: number; document: DiagramDocument };
export function EditorPage({ id }: { id: string }) {
  const [diagram, setDiagram] = useState<Diagram | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    api<Diagram>(`diagrams/${id}`)
      .then(setDiagram)
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
    [interacting, setInteracting] = useState(false);
  const docRef = useRef(document),
    revisionRef = useRef(revision),
    savingRef = useRef(false),
    gesture = useRef<DiagramDocument | null>(null),
    file = useRef<HTMLInputElement>(null);
  const serialized = useMemo(() => JSON.stringify(document), [document]);
  const dirty = serialized !== savedDoc;
  const errors = useMemo(() => diagramErrors(document), [document]);
  const change = useCallback((next: DiagramDocument, record = true) => {
    if (JSON.stringify(next) === JSON.stringify(docRef.current)) return;
    if (record) {
      setUndo((u) => [...u.slice(-49), structuredClone(docRef.current)]);
      setRedo([]);
    }
    docRef.current = next;
    setDocument(next);
    setError('');
  }, []);
  const save = useCallback(
    async (retry = false): Promise<boolean> => {
      if (gesture.current || savingRef.current || (blocked && !retry)) return false;
      const snapshot = docRef.current;
      const issues = diagramErrors(snapshot);
      if (issues.length) {
        setError(issues.join('; '));
        return false;
      }
      savingRef.current = true;
      setSaving(true);
      setError('');
      try {
        const result = await api<Diagram>(`diagrams/${initial.id}`, 'PUT', {
          revision: revisionRef.current,
          document: snapshot,
        });
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
      const type = docRef.current.notation.nodeTypes.find((t) => t.id === node.typeId)!;
      const hasTitle = type.properties.some((p) => p.key === 'title' && p.type === 'string');
      change(
        {
          ...docRef.current,
          nodes: docRef.current.nodes.map((n) =>
            n.id === id
              ? hasTitle
                ? { ...n, label: undefined, properties: { ...n.properties, title: text } }
                : { ...n, label: text }
              : n,
          ),
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
  function addNode(typeId: string) {
    const definition = document.notation.nodeTypes.find((t) => t.id === typeId)!;
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
    const id = `node-${crypto.randomUUID()}`;
    change({
      ...docRef.current,
      nodes: [
        ...docRef.current.nodes,
        { id, typeId, position, properties: defaults(definition.properties) },
      ],
    });
    setSelected({ kind: 'node', id });
  }
  function candidate(c: {
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }): DiagramDocument {
    return {
      ...docRef.current,
      edges: [
        ...docRef.current.edges,
        {
          id: `edge-${crypto.randomUUID()}`,
          typeId: edgeType,
          source: c.source,
          target: c.target,
          sourcePort: c.sourceHandle ?? '',
          targetPort: c.targetHandle ?? '',
          properties: defaults(
            document.notation.edgeTypes.find((t) => t.id === edgeType)!.properties,
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
        data: { definition, node: n, shapes: document.notation.shapes },
        selected: isSelected,
      };
      nodeCache.current.set(n.id, next);
      return next;
    });
    const ids = new Set(document.nodes.map((n) => n.id));
    for (const id of nodeCache.current.keys()) if (!ids.has(id)) nodeCache.current.delete(id);
    return result;
  }, [document.nodes, document.notation, selected]);
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
          label: String(e.properties.label ?? ''),
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
    [document.edges, styledEdges, selected, initial.id],
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
    setRedo((r) => [...r, structuredClone(docRef.current)]);
    setUndo(undo.slice(0, -1));
    change(previous, false);
  }
  function redoAction() {
    if (!redo.length) return;
    const next = redo[redo.length - 1];
    setUndo((u) => [...u, structuredClone(docRef.current)]);
    setRedo(redo.slice(0, -1));
    change(next, false);
  }
  const selectedObject =
    selected?.kind === 'node'
      ? document.nodes.find((n) => n.id === selected.id)
      : selected?.kind === 'edge'
        ? document.edges.find((e) => e.id === selected.id)
        : undefined;
  const definition = selectedObject
    ? selected?.kind === 'node'
      ? document.notation.nodeTypes.find((t) => t.id === selectedObject.typeId)
      : document.notation.edgeTypes.find((t) => t.id === selectedObject.typeId)
    : undefined;
  const selectedNode =
    selected?.kind === 'node' ? document.nodes.find((n) => n.id === selected.id) : undefined;
  const selectedEdge =
    selected?.kind === 'edge' ? document.edges.find((e) => e.id === selected.id) : undefined;
  const selectedNodeAppearance = selectedNode
    ? nodeAppearance(
        selectedNode,
        document.notation.nodeTypes.find((t) => t.id === selectedNode.typeId)!,
      )
    : undefined;
  function propertyChange(key: string, value: string | number | boolean) {
    if (!selected) return;
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
  async function showHistory() {
    try {
      setRevisions(await api(`diagrams/${initial.id}/revisions`));
      setHistoryOpen(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <main className="editor">
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
            disabled={interacting || !undo.length}
            onClick={undoAction}
          >
            <Undo2 size={18} />
          </button>
          <button
            className="icon-button"
            title="Повторить"
            aria-label="Повторить"
            disabled={interacting || !redo.length}
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
            onClick={() => download(`${name}.maket.json`, { name, document: docRef.current })}
          >
            <Download size={16} />
            Экспорт
          </button>
          <button
            className="primary small"
            onClick={() => void save(true)}
            disabled={interacting || saving || (!dirty && !blocked)}
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
      <div className="editor-body">
        <aside className="palette">
          <div className="palette-title">
            <h3>Инструменты</h3>
            <span className="badge">{document.notation.nodeTypes.length}</span>
          </div>
          <p className="muted small-text">Нажмите, чтобы добавить элемент</p>
          <div className="palette-section">ЭЛЕМЕНТЫ</div>
          {document.notation.nodeTypes.map((t) => (
            <button className="palette-item" key={t.id} onClick={() => addNode(t.id)}>
              <span
                className={`palette-shape ${t.appearance.shape}`}
                style={{ borderColor: t.appearance.stroke, background: t.appearance.fill }}
              />
              <span>{t.name}</span>
              <Plus size={14} />
            </button>
          ))}
          <div className="palette-section">СОЕДИНЕНИЯ</div>
          <label className="small-text">
            Тип связи
            <select
              value={edgeType}
              onChange={(e) => setEdgeType(e.target.value)}
              aria-label="Тип связи"
            >
              {document.notation.edgeTypes.map((t) => (
                <option value={t.id} key={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small-text">
            Перетащите связь от правого порта к левому. Разрешены только связи по правилам нотации.
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
                    next = diagramSchema.parse(raw.document ?? raw);
                  if (JSON.stringify(next.notation) !== JSON.stringify(document.notation))
                    throw new Error(
                      'Другая нотация. Импортируйте файл как новую диаграмму в библиотеке.',
                    );
                  if (diagramErrors(next).length) throw new Error(diagramErrors(next).join('; '));
                  change(next);
                  flow.fitView();
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
        <div className="flow-container">
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
              onConnect={(c) => {
                const next = candidate(c);
                const issues = diagramErrors(next);
                if (issues.length) setError(issues.join('; '));
                else change(next);
              }}
              isValidConnection={(c) => diagramErrors(candidate(c)).length === 0}
              snapToGrid={user.settings.snapToGrid}
              snapGrid={[20, 20]}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
              deleteKeyCode={['Backspace', 'Delete']}
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
                  <strong>{definition.name}</strong>
                  <small>{selected?.kind === 'node' ? 'Элемент' : 'Соединение'}</small>
                </div>
              </div>
              <div className="form-stack">
                {definition.properties.map((p) => (
                  <label key={p.key}>
                    {p.label}
                    {p.required && <span className="required"> *</span>}
                    {p.type === 'boolean' ? (
                      <input
                        type="checkbox"
                        checked={Boolean(selectedObject.properties[p.key])}
                        onChange={(e) => propertyChange(p.key, e.target.checked)}
                      />
                    ) : (
                      <input
                        type={p.type === 'number' ? 'number' : 'text'}
                        value={String(selectedObject.properties[p.key] ?? '')}
                        onChange={(e) =>
                          propertyChange(
                            p.key,
                            p.type === 'number' ? Number(e.target.value) : e.target.value,
                          )
                        }
                        maxLength={2000}
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
                      {document.notation.shapes?.map((s) => (
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
                  <h3>Оформление связи</h3>
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
                  disabled={r.number === revision || saving}
                  onClick={async () => {
                    if (
                      !confirm('Восстановить эту версию? Несохранённые изменения будут потеряны.')
                    )
                      return;
                    try {
                      const d = await api<Diagram>(`diagrams/${initial.id}/restore`, 'POST', {
                        revision: revisionRef.current,
                        number: r.number,
                      });
                      change(d.document);
                      setSavedDoc(JSON.stringify(d.document));
                      revisionRef.current = d.revision;
                      setRevision(d.revision);
                      setBlocked(false);
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
    </main>
  );
}
