'use client';
import { useLayoutEffect } from 'react';
import { ImportedHandles, type ImportedHandle } from './imported-edge';
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
export type RelationAnchorNode = Node<
  { name: string; importedHandles?: ImportedHandle[] },
  'relation-anchor'
>;
export function RelationAnchor({ id, data, selected }: NodeProps<RelationAnchorNode>) {
  const update = useUpdateNodeInternals();
  const signature = JSON.stringify(data.importedHandles);
  useLayoutEffect(() => update(id), [id, signature, update]);
  return (
    <div className={`relation-anchor ${selected ? 'selected' : ''}`} title={`Связь: ${data.name}`}>
      <ImportedHandles handles={data.importedHandles} />
      <Handle type="source" position={Position.Left} id="in" title="Точка подключения слева" />
      <Handle type="source" position={Position.Right} id="out" title="Точка подключения справа" />
    </div>
  );
}

export type FreeEndpointNode = Node<{ edgeId: string; end: 'source' | 'target' }, 'free-endpoint'>;
export function FreeEndpoint({ data }: NodeProps<FreeEndpointNode>) {
  return (
    <div
      className="free-endpoint"
      title="Свободный конец: перетащите конец стрелки к порту элемента"
    >
      <Handle
        type={data.end === 'source' ? 'source' : 'target'}
        position={data.end === 'source' ? Position.Right : Position.Left}
        id="free"
        isConnectable={false}
      />
    </div>
  );
}
