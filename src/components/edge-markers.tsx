import type { EdgeAppearance } from '@/lib/appearance';
export function markerId(diagramId: string, edgeId: string, end: 'start' | 'end') {
  return `maket-${diagramId}-${edgeId}-${end}`;
}
function Marker({
  id,
  kind,
  color,
  size,
}: {
  id: string;
  kind: EdgeAppearance['targetMarker'];
  color: string;
  size: number;
}) {
  if (kind === 'none') return null;
  const hollow = kind.startsWith('hollow-');
  const fill = hollow ? 'var(--canvas-bg)' : color;
  return (
    <marker
      id={id}
      viewBox="-1 -1 12 12"
      refX="10"
      refY="5"
      markerWidth={size}
      markerHeight={size}
      markerUnits="userSpaceOnUse"
      orient="auto-start-reverse"
    >
      {kind === 'thin-arrow' ? (
        <path d="M 1 0 L 10 5 L 1 10" fill="none" stroke={color} strokeWidth="1.3" />
      ) : kind === 'thick-arrow' ? (
        <path d="M 0 0 L 10 5 L 0 10 L 3 5 Z" fill={color} />
      ) : kind === 'diamond' || kind === 'hollow-diamond' ? (
        <path d="M 0 5 L 5 0 L 10 5 L 5 10 Z" fill={fill} stroke={color} strokeWidth="1" />
      ) : kind === 'circle' ? (
        <circle cx="5" cy="5" r="4.5" fill={color} />
      ) : (
        <path d="M 0 0 L 10 5 L 0 10 Z" fill={fill} stroke={color} strokeWidth="1" />
      )}
    </marker>
  );
}
export function EdgeMarkers({
  diagramId,
  edges,
}: {
  diagramId: string;
  edges: { id: string; appearance: EdgeAppearance }[];
}) {
  return (
    <svg className="edge-marker-definitions" aria-hidden="true">
      <defs>
        {edges.flatMap((e) => [
          <Marker
            key={`${e.id}-end`}
            id={markerId(diagramId, e.id, 'end')}
            kind={e.appearance.targetMarker}
            color={e.appearance.color}
            size={e.appearance.markerSize ?? 18}
          />,
          <Marker
            key={`${e.id}-start`}
            id={markerId(diagramId, e.id, 'start')}
            kind={e.appearance.sourceMarker ?? 'none'}
            color={e.appearance.color}
            size={e.appearance.markerSize ?? 18}
          />,
        ])}
      </defs>
    </svg>
  );
}
