'use client';
import { BaseEdge, Handle, Position, type EdgeProps } from '@xyflow/react';
import type { EdgeGeometry } from '@/lib/diagram-geometry';

export const importedHandleId = (id: string, side: 'source' | 'target') => `imported:${id}:${side}`;
export type ImportedHandle = { id: string; side: 'source' | 'target'; x: number; y: number };
export function ImportedHandles({ handles }: { handles?: ImportedHandle[] }) {
  return handles?.map((handle) => (
    <Handle
      key={handle.id}
      id={handle.id}
      type={handle.side}
      position={handle.side === 'source' ? Position.Right : Position.Left}
      isConnectable={false}
      style={{
        left: handle.x,
        top: handle.y,
        right: 'auto',
        transform: 'translate(-50%, -50%)',
        visibility: 'hidden',
      }}
    />
  ));
}
export function ImportedEdge(props: EdgeProps) {
  const geometry = props.data?.geometry as EdgeGeometry | undefined;
  if (!geometry) return null;
  return (
    <BaseEdge
      id={props.id}
      path={geometry.path}
      label={props.label}
      labelX={geometry.label.x}
      labelY={geometry.label.y}
      labelStyle={props.labelStyle}
      labelBgStyle={props.labelBgStyle}
      markerStart={props.markerStart}
      markerEnd={props.markerEnd}
      style={props.style}
      interactionWidth={props.interactionWidth}
    />
  );
}
export const importedEdgeTypes = { imported: ImportedEdge };
