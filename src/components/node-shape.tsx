import { memo } from 'react';
import { shapePath, type CustomShape, type NodeAppearance } from '@/lib/appearance';
export const NodeShape = memo(function NodeShape({
  appearance: a,
  shapes = [],
  className = 'node-shape',
}: {
  appearance: NodeAppearance;
  shapes?: CustomShape[];
  className?: string;
}) {
  const stroke = a.strokeWidth ?? 2,
    inset = stroke / 2 + 1;
  const common = {
    fill: a.fill,
    stroke: a.stroke,
    strokeWidth: stroke,
    strokeLinejoin: 'round' as const,
  };
  const custom = shapes.find((s) => s.id === a.shapeId);
  return (
    <svg
      width={a.width}
      height={a.height}
      viewBox={`0 0 ${a.width} ${a.height}`}
      className={className}
      aria-hidden="true"
    >
      {a.shape === 'ellipse' ? (
        <ellipse
          cx={a.width / 2}
          cy={a.height / 2}
          rx={Math.max(1, a.width / 2 - inset)}
          ry={Math.max(1, a.height / 2 - inset)}
          {...common}
        />
      ) : a.shape === 'diamond' ? (
        <polygon
          points={`${a.width / 2},${inset} ${a.width - inset},${a.height / 2} ${a.width / 2},${a.height - inset} ${inset},${a.height / 2}`}
          {...common}
        />
      ) : a.shape === 'custom' && custom ? (
        <g transform={`translate(${inset},${inset})`}>
          <path d={shapePath(custom, a.width - 2 * inset, a.height - 2 * inset)} {...common} />
        </g>
      ) : a.shape !== 'text' ? (
        <rect
          x={inset}
          y={inset}
          width={Math.max(1, a.width - inset * 2)}
          height={Math.max(1, a.height - inset * 2)}
          rx={a.shape === 'rounded' ? 12 : 0}
          {...common}
        />
      ) : null}
    </svg>
  );
});
