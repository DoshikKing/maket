import { NodeText } from './node-text';
import { nodeTextBounds } from '@/lib/node-text';
import { layeredElements } from './layered-elements';
import type { Ref, SVGProps } from 'react';
import { NodeShape } from './node-shape';
import { EdgeMarkerDefs, markerId } from './edge-markers';
import { edgeGeometry } from '@/lib/diagram-geometry';
import {
  nodeAppearance,
  fontCss,
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
    const definition = d.notation.nodeTypes.find((t) => t.id === n.typeId)!;
    const a = nodeAppearance(n, definition);
    return [
      n.position,
      { x: n.position.x + a.width, y: n.position.y + a.height },
      ...nodeTextBounds(
        a,
        nodeLabel(n, definition),
        a.showAttributes === false
          ? []
          : visibleProperties(n, definition).map((p) => `${p.label}: ${p.value}`),
      ).map((p) => ({ x: p.x + n.position.x, y: p.y + n.position.y })),
    ];
  });
  for (const g of edgeGeometry(d).values()) points.push(...g.points, g.label);
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
  const d: ViewDocument = { ...document, ...displayedView(document, objects) },
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
        {layeredElements(d, [
          ...d.edges.map((e, i) => {
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
                    x={g.label.x}
                    y={e.labelPosition ? g.label.y : g.label.y - 8}
                    dominantBaseline={e.labelPosition ? 'middle' : undefined}
                    textAnchor="middle"
                    fill="#232334"
                    stroke="#ffffff"
                    strokeWidth="4"
                    paintOrder="stroke"
                    {...fontCss(a)}
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
          }),
          ...d.nodes.map((n) => {
            const t = d.notation.nodeTypes.find((t) => t.id === n.typeId)!,
              a = nodeAppearance(n, t);
            const attrs =
              a.showAttributes === false
                ? []
                : visibleProperties(n, t).map((p) => `${p.label}: ${p.value}`);
            return (
              <g
                key={n.id}
                data-representation-id={n.id}
                onClick={() => onSelect?.(n.id)}
                transform={`translate(${n.position.x},${n.position.y})`}
                style={{ cursor: onSelect ? 'pointer' : undefined }}
              >
                <NodeShape appearance={a} shapes={d.notation.shapes} className="svg-node-shape" />
                {n.instanceOf && (
                  <text
                    x={a.width / 2}
                    y={-5}
                    textAnchor="middle"
                    fill="#0d9488"
                    fontSize={11}
                    data-instance-of={n.instanceOf}
                  >
                    «instance»
                  </text>
                )}
                <g fill={a.shape === 'text' ? '#232334' : contrastColor(a.fill)}>
                  <NodeText
                    appearance={a}
                    title={nodeLabel(n, t)}
                    attributes={attrs}
                    clipId={`text-${n.id}`}
                  />
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
          }),
        ])}
      </g>
    </svg>
  );
}
