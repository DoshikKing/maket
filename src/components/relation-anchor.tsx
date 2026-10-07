'use client';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
export type RelationAnchorNode = Node<{ name: string }, 'relation-anchor'>;
export function RelationAnchor({ data, selected }: NodeProps<RelationAnchorNode>) {
  return (
    <div className={`relation-anchor ${selected ? 'selected' : ''}`} title={`Связь: ${data.name}`}>
      <Handle type="target" position={Position.Left} id="in" title="Вход связи" />
      <span aria-hidden="true">◇</span>
      <Handle type="source" position={Position.Right} id="out" title="Выход связи" />
    </div>
  );
}
