'use client';
import type { Ref, SVGProps } from 'react';
import { NodeShape } from './node-shape';
import { EdgeMarkerDefs, markerId } from './edge-markers';
import { edgeGeometry } from '@/lib/diagram-geometry';
import {
  nodeAppearance,
  nodeLabel,
  visibleProperties,
  contrastColor,
  edgeAppearance,
  lineDash,
} from '@/lib/appearance';
import { displayedView, effectiveEdge, type ViewDocument, type ModelObject } from '@/lib/model';
export type Bounds = { x: number; y: number; width: number; height: number };
export function diagramBounds(d: ViewDocument): Bounds {
  const points = d.nodes.flatMap((n) => {
    const a = nodeAppearance(
      n,
      d.notation.nodeTypes.find((t) => t.id === n.typeId)!,
    );
    return [n.position, { x: n.position.x + a.width, y: n.position.y + a.height }];
  });
  for (const g of edgeGeometry(d).values()) points.push(g.source, g.target, g.center);
  if (!points.length) return { x: 0, y: 0, width: 600, height: 400 };
  const x = Math.min(...points.map((p) => p.x)) - 60,
    y = Math.min(...points.map((p) => p.y)) - 60;
  return {
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x + 60,
    height: Math.max(...points.map((p) => p.y)) - y + 60,
  };
}
function lines(text: string, columns: number) {
  return text
    .split('\n')
    .flatMap((row) => row.match(new RegExp(`.{1,${Math.max(1, columns)}}`, 'gu')) ?? ['']);
}
export function DiagramSvg({
  document,
  objects,
  svgRef,
  selectedId,
  onSelect,
  bounds,
  ...props
}: {
  document: ViewDocument;
  objects: ModelObject[];
  svgRef?: Ref<SVGSVGElement>;
  selectedId?: string;
  onSelect?: (id: string) => void;
  bounds?: Bounds;
} & Omit<SVGProps<SVGSVGElement>, 'onSelect'>) {
  const d = { ...document, nodes: displayedView(document, objects).nodes },
    box = bounds ?? diagramBounds(d),
    geometry = edgeGeometry(d);
  const styled = d.edges.map((e) => ({
    id: e.id,
    appearance: edgeAppearance(
      d.notation.edgeTypes.find((t) => t.id === e.typeId)!.appearance,
      e.appearance,
    ),
  }));
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      ref={svgRef}
      width={box.width}
      height={box.height}
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      role="img"
      aria-label="Диаграмма"
      style={
        {
          '--canvas-bg': '#ffffff',
          '--text': '#232334',
          fontFamily: 'Arial, sans-serif',
        } as React.CSSProperties
      }
      {...props}
    >
      <EdgeMarkerDefs diagramId="svg" edges={styled} />
      <g data-diagram-content="true">
        {d.edges.map((e, i) => {
          const g = geometry.get(e.id);
          if (!g) return null;
          const a = styled[i].appearance,
            t = d.notation.edgeTypes.find((t) => t.id === e.typeId)!;
          const label = String(
            effectiveEdge(
              e,
              t,
              d.relations?.find((r) => r.id === e.relationId),
            ).properties.label ?? '',
          );
          return (
            <g
              key={e.id}
              data-representation-id={e.id}
              onClick={() => onSelect?.(e.id)}
              style={{ cursor: onSelect ? 'pointer' : undefined }}
            >
              <path
                d={g.path}
                fill="none"
                stroke={a.color}
                strokeWidth={a.width}
                strokeDasharray={lineDash(a)}
                strokeLinecap={a.line === 'dotted' ? 'round' : 'butt'}
                markerStart={
                  a.sourceMarker && a.sourceMarker !== 'none'
                    ? `url(#${markerId('svg', e.id, 'start')})`
                    : undefined
                }
                markerEnd={
                  a.targetMarker !== 'none' ? `url(#${markerId('svg', e.id, 'end')})` : undefined
                }
              />
              {label && (
                <text
                  x={g.center.x}
                  y={g.center.y - 8}
                  textAnchor="middle"
                  fill="#232334"
                  stroke="#ffffff"
                  strokeWidth="4"
                  paintOrder="stroke"
                  fontSize={a.fontSize ?? 12}
                >
                  {label}
                </text>
              )}
              {onSelect && <path d={g.path} fill="none" stroke="transparent" strokeWidth="16" />}
              {selectedId === e.id && (
                <circle
                  cx={g.center.x}
                  cy={g.center.y}
                  r="8"
                  fill="none"
                  stroke="#7060da"
                  strokeWidth="3"
                />
              )}
            </g>
          );
        })}
        {[...d.nodes]
          .sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0))
          .map((n) => {
            const t = d.notation.nodeTypes.find((t) => t.id === n.typeId)!,
              a = nodeAppearance(n, t);
            const font = a.fontSize ?? 12,
              vertical = Math.abs(a.textRotation ?? 0) === 90;
            const w = (vertical ? a.height : a.width) - 24,
              h = (vertical ? a.width : a.height) - 16;
            const text = lines(nodeLabel(n, t), Math.floor(w / (font * 0.6)));
            const attrs =
              a.showAttributes !== false
                ? visibleProperties(n, t).flatMap((p) =>
                    lines(`${p.label}: ${p.value}`, Math.floor(w / (Math.max(8, font - 2) * 0.6))),
                  )
                : [];
            const height = text.length * font * 1.25 + attrs.length * Math.max(8, font - 2) * 1.25;
            const align = a.textAlign ?? 'center',
              anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
            const x = align === 'left' ? -w / 2 : align === 'right' ? w / 2 : 0;
            return (
              <g
                key={n.id}
                data-representation-id={n.id}
                onClick={() => onSelect?.(n.id)}
                transform={`translate(${n.position.x},${n.position.y})`}
                style={{ cursor: onSelect ? 'pointer' : undefined }}
              >
                <NodeShape appearance={a} shapes={d.notation.shapes} className="svg-node-shape" />
                <defs>
                  <clipPath id={`text-${n.id}`}>
                    <rect x={-w / 2} y={-h / 2} width={Math.max(1, w)} height={Math.max(1, h)} />
                  </clipPath>
                </defs>
                <g
                  transform={`translate(${a.width / 2},${a.height / 2}) rotate(${a.textRotation ?? 0})`}
                  clipPath={`url(#text-${n.id})`}
                >
                  <text
                    x={x}
                    y={-Math.min(height, h) / 2 + font}
                    textAnchor={anchor}
                    fill={a.shape === 'text' ? '#232334' : contrastColor(a.fill)}
                    fontSize={font}
                  >
                    {text.map((line, i) => (
                      <tspan key={i} x={x} dy={i ? font * 1.25 : 0}>
                        {line}
                      </tspan>
                    ))}
                    {attrs.map((line, i) => (
                      <tspan
                        key={`a${i}`}
                        x={x}
                        dy={Math.max(8, font - 2) * 1.25}
                        fontSize={Math.max(8, font - 2)}
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
                {selectedId === n.id && (
                  <rect
                    x="-4"
                    y="-4"
                    width={a.width + 8}
                    height={a.height + 8}
                    fill="none"
                    stroke="#7060da"
                    strokeWidth="3"
                    strokeDasharray="6 3"
                  />
                )}
              </g>
            );
          })}
      </g>
    </svg>
  );
}
