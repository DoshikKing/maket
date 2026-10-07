'use client';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
export type RelationAnchorNode = Node<{ name: string }, 'relation-anchor'>;
export function RelationAnchor({ data, selected }: NodeProps<RelationAnchorNode>) {
  return (
    <div className={`relation-anchor ${selected ? 'selected' : ''}`} title={`Связь: ${data.name}`}>
      <Handle type="source" position={Position.Left} id="in" title="Точка подключения слева" />
      <Handle type="source" position={Position.Right} id="out" title="Точка подключения справа" />
    </div>
  );
}
