'use client';
import {
  createContext,
  memo,
  useContext,
  useRef,
  useState,
  useLayoutEffect,
  useEffect,
  type CSSProperties,
} from 'react';
import {
  Handle,
  NodeResizer,
  Position,
  useUpdateNodeInternals,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import type { NotationDocument } from '@/lib/notation';
import {
  contrastColor,
  fontCss,
  nodeAppearance,
  nodeLabel,
  visibleProperties,
  type CustomShape,
  type DiagramNode,
} from '@/lib/appearance';
import { ImportedHandles, type ImportedHandle } from './imported-edge';
import { NodeShape } from './node-shape';
import { nodeTextBox } from '@/lib/node-text';
import { effectiveNode, type ModelObject } from '@/lib/model';
export type ShapeData = {
  definition: NotationDocument['nodeTypes'][number];
  node: DiagramNode;
  shapes?: CustomShape[];
  object?: ModelObject;
  importedHandles?: ImportedHandle[];
};
export type ShapeNode = Node<ShapeData, 'notation'>;
export const NodeActionsContext = createContext<{
  editable: boolean;
  begin: (kind: 'resize' | 'text') => void;
  end: () => void;
  label: (id: string, text: string) => void;
}>({ editable: false, begin: () => {}, end: () => {}, label: () => {} });
export const DiagramNodeView = memo(function DiagramNodeView({
  id,
  data,
  selected,
}: NodeProps<ShapeNode>) {
  const actions = useContext(NodeActionsContext);
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState('');
  const active = useRef(false);
  const { definition: t, shapes, object } = data,
    node = effectiveNode(data.node, t, object),
    a = nodeAppearance(node, t),
    title = nodeLabel(node, t);
  const attrs = a.showAttributes !== false ? visibleProperties(node, t) : [];
  const inputs = t.ports.filter((p) => p.direction === 'input'),
    outputs = t.ports.filter((p) => p.direction === 'output');
  const updateInternals = useUpdateNodeInternals();
  const portSignature = t.ports.map((p) => `${p.id}:${p.direction}`).join(',');
  const importedSignature = JSON.stringify(data.importedHandles);
  useLayoutEffect(
    () => updateInternals(id),
    [id, portSignature, importedSignature, updateInternals],
  );
  useEffect(
    () => () => {
      if (active.current) {
        active.current = false;
        actions.end();
      }
    },
    [actions.end],
  );
  const rotation = a.textRotation ?? 0;
  const textBox = nodeTextBox(a);
  function finish(cancel = false) {
    if (!active.current) return;
    active.current = false;
    if (!cancel) actions.label(id, draft);
    setEditing(false);
    actions.end();
  }
  return (
    <div
      className={`canvas-node ${selected ? 'selected' : ''} ${object?.archived ? 'archived-object' : ''}`}
      style={{ width: a.width, height: a.height }}
      onDoubleClick={(e) => {
        if (
          (e.target as Element).closest(
            'input,textarea,.react-flow__handle,.react-flow__resize-control',
          )
        )
          return;
        e.stopPropagation();
        if (!actions.editable || active.current) return;
        active.current = true;
        setDraft(title);
        setEditing(true);
        actions.begin('text');
      }}
    >
      <NodeResizer
        isVisible={actions.editable && !!selected && !editing}
        minWidth={40}
        minHeight={30}
        maxWidth={2000}
        maxHeight={1600}
        color="var(--accent)"
        onResizeStart={() => actions.begin('resize')}
        onResizeEnd={() => actions.end()}
      />
      <NodeShape appearance={a} shapes={shapes} />
      {(object?.derivation === 'instance' || node.instanceOf) && (
        <span
          className="instance-marker"
          title="Экземпляр базового объекта"
          data-instance-of={object?.baseId ?? node.instanceOf}
        >
          «instance»
        </span>
      )}
      {object?.archived && <span className="archived-marker">Архив</span>}
      <div
        className={`node-content ${a.shape === 'diamond' ? 'diamond-content' : ''}`}
        style={{
          left: textBox.x,
          top: textBox.y,
          width: textBox.width,
          maxHeight: textBox.height,
          ...fontCss(a),
          color: a.shape === 'text' ? 'var(--text)' : contrastColor(a.fill),
          fontSize: a.fontSize ?? 12,
          textAlign: a.textAlign ?? 'center',
          transform: `translate(-50%, ${-textBox.anchor * 100}%) rotate(${rotation}deg)`,
        }}
      >
        {editing ? (
          <textarea
            className="node-inline-editor nodrag nopan nowheel"
            aria-label="Текст объекта"
            value={draft}
            maxLength={2000}
            autoFocus
            onFocus={(e) => e.target.select()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => finish()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') {
                e.preventDefault();
                finish(true);
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                finish();
              }
            }}
          />
        ) : (
          <div className="node-label">{title}</div>
        )}
        {!editing && attrs.length > 0 && (
          <div
            className="node-attributes"
            style={{ fontSize: Math.max(8, (a.fontSize ?? 12) - 2) }}
          >
            {attrs.map((p) => (
              <div key={p.key} data-property={p.key}>
                {p.label}: {p.value}
              </div>
            ))}
          </div>
        )}
      </div>
      <ImportedHandles handles={data.importedHandles} />
      {[inputs, outputs].flatMap((ports, side) =>
        ports.map((p, i) => (
          <Handle
            key={p.id}
            type={side ? 'source' : 'target'}
            position={side ? Position.Right : Position.Left}
            id={p.id}
            className="face-port"
            style={
              {
                top: `${(i / ports.length) * 100}%`,
                '--face-height': `${100 / ports.length}%`,
              } as CSSProperties
            }
            title={`${side ? 'Выход' : 'Вход'}: ${p.id}. Подключение в любом месте грани`}
            role="button"
            aria-disabled={!actions.editable}
            aria-label={`${side ? 'Выход' : 'Вход'} ${p.id}`}
            tabIndex={actions.editable ? 0 : -1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                e.preventDefault();
                if (e.key === 'Enter') e.currentTarget.click();
              }
            }}
            onKeyUp={(e) => {
              if (e.key === ' ') {
                e.stopPropagation();
                e.preventDefault();
                e.currentTarget.click();
              }
            }}
          />
        )),
      )}
    </div>
  );
});
export const diagramNodeTypes = { notation: DiagramNodeView };
