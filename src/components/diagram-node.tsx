'use client';
import { createContext, memo, useContext, useRef, useState, useLayoutEffect } from 'react';
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
  nodeAppearance,
  nodeLabel,
  visibleProperties,
  type CustomShape,
  type DiagramNode,
} from '@/lib/appearance';
import { NodeShape } from './node-shape';
import { effectiveNode, type ModelObject } from '@/lib/model';
export type ShapeData = {
  definition: NotationDocument['nodeTypes'][number];
  node: DiagramNode;
  shapes?: CustomShape[];
  object?: ModelObject;
};
export type ShapeNode = Node<ShapeData, 'notation'>;
export const NodeActionsContext = createContext<{
  begin: (kind: 'resize' | 'text') => void;
  end: () => void;
  label: (id: string, text: string) => void;
}>({ begin: () => {}, end: () => {}, label: () => {} });
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
  useLayoutEffect(() => updateInternals(id), [id, portSignature, updateInternals]);
  const rotation = a.textRotation ?? 0;
  const vertical = Math.abs(rotation) === 90;
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
        if (active.current) return;
        active.current = true;
        setDraft(title);
        setEditing(true);
        actions.begin('text');
      }}
    >
      <NodeResizer
        isVisible={!!selected && !editing}
        minWidth={40}
        minHeight={30}
        maxWidth={2000}
        maxHeight={1600}
        color="var(--accent)"
        onResizeStart={() => actions.begin('resize')}
        onResizeEnd={() => actions.end()}
      />
      <NodeShape appearance={a} shapes={shapes} />
      {object?.archived && <span className="archived-marker">Архив</span>}
      <div
        className={`node-content ${a.shape === 'diamond' ? 'diamond-content' : ''}`}
        style={{
          width: (vertical ? a.height : a.width) - 24,
          maxHeight: (vertical ? a.width : a.height) - 16,
          color: a.shape === 'text' ? 'var(--text)' : contrastColor(a.fill),
          fontSize: a.fontSize ?? 12,
          textAlign: a.textAlign ?? 'center',
          transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
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
      {inputs.map((p, i) => (
        <Handle
          key={p.id}
          type="target"
          position={Position.Left}
          id={p.id}
          style={{ top: `${((i + 1) / (inputs.length + 1)) * 100}%` }}
          title={p.id}
        />
      ))}
      {outputs.map((p, i) => (
        <Handle
          key={p.id}
          type="source"
          position={Position.Right}
          id={p.id}
          style={{ top: `${((i + 1) / (outputs.length + 1)) * 100}%` }}
          title={p.id}
        />
      ))}
    </div>
  );
});
export const diagramNodeTypes = { notation: DiagramNodeView };
