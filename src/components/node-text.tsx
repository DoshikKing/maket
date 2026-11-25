import { fontCss, type NodeAppearance } from '@/lib/appearance';
import { nodeTextMetrics } from '@/lib/node-text';
export function NodeText({
  appearance: a,
  title,
  attributes = [],
  clipId,
}: {
  appearance: NodeAppearance;
  title: string;
  attributes?: string[];
  clipId: string;
}) {
  const m = nodeTextMetrics(a, title, attributes),
    align = a.textAlign ?? 'center';
  const x = align === 'left' ? -m.width / 2 : align === 'right' ? m.width / 2 : 0;
  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <rect
            x={-m.width / 2}
            y={-m.contentHeight / 2}
            width={m.width}
            height={m.contentHeight}
          />
        </clipPath>
      </defs>
      <g
        data-node-label="true"
        transform={`translate(${m.x},${m.centerY}) rotate(${a.textRotation ?? 0})`}
        clipPath={`url(#${clipId})`}
      >
        <text
          x={x}
          y={-m.contentHeight / 2 + m.font * 1.1}
          textAnchor={align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'}
          fontSize={m.font}
          {...fontCss(a)}
        >
          {m.lines.map((line, i) => (
            <tspan key={i} x={x} dy={i ? m.font * 1.4 : 0}>
              {line}
            </tspan>
          ))}
          {m.attrs.map((line, i) => (
            <tspan key={`a${i}`} x={x} fontSize={m.smallFont} dy={m.smallFont * 1.4 + (i ? 0 : 10)}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
    </>
  );
}
