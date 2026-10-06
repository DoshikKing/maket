import { z } from 'zod';
import type { DiagramDocument, NotationDocument } from './notation';

export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const baseShapes = ['rectangle', 'rounded', 'diamond', 'ellipse', 'text'] as const;
export const shapeSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .max(100),
    name: z.string().trim().min(1).max(100),
    baseShape: z.enum(['rectangle', 'rounded', 'diamond', 'ellipse']),
    points: z
      .array(z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }))
      .min(3)
      .max(32),
    rounding: z.number().min(0).max(45),
  })
  .superRefine((shape, ctx) => {
    const area = shape.points.reduce((sum, p, i) => {
      const next = shape.points[(i + 1) % shape.points.length];
      return sum + p.x * next.y - next.x * p.y;
    }, 0);
    if (Math.abs(area) < 1)
      ctx.addIssue({ code: 'custom', message: 'Форма должна иметь ненулевую площадь' });
  });
export type CustomShape = z.infer<typeof shapeSchema>;
export const textAppearanceSchema = z.object({
  fontSize: z.number().min(8).max(72).optional(),
  textRotation: z.number().min(-180).max(180).optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  showAttributes: z.boolean().optional(),
});
export const nodeAppearanceSchema = textAppearanceSchema.extend({
  shape: z.enum([...baseShapes, 'custom']),
  shapeId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .max(100)
    .optional(),
  width: z.number().min(40).max(600),
  height: z.number().min(30).max(400),
  fill: colorSchema,
  stroke: colorSchema,
  strokeWidth: z.number().min(0.5).max(12).optional(),
});
export const nodeOverrideSchema = nodeAppearanceSchema
  .omit({ width: true, height: true })
  .partial();
export const markers = [
  'none',
  'arrow',
  'thin-arrow',
  'thick-arrow',
  'triangle',
  'hollow-triangle',
  'diamond',
  'hollow-diamond',
  'circle',
] as const;
export const edgeAppearanceSchema = z.object({
  line: z.enum(['solid', 'dashed', 'dotted', 'dash-dot', 'custom']),
  targetMarker: z.enum(markers),
  sourceMarker: z.enum(markers).optional(),
  color: colorSchema.default('#64748b'),
  width: z.number().min(0.5).max(12).optional(),
  markerSize: z.number().min(8).max(40).optional(),
  dashPattern: z.array(z.number().positive().max(50)).min(2).max(8).optional(),
  routing: z.enum(['smoothstep', 'straight', 'bezier']).optional(),
  fontSize: z.number().min(8).max(48).optional(),
});
export const edgeOverrideSchema = edgeAppearanceSchema
  .omit({ color: true })
  .extend({ color: colorSchema.optional() })
  .partial();
export type NodeAppearance = z.infer<typeof nodeAppearanceSchema>;
export type NodeOverride = z.infer<typeof nodeOverrideSchema>;
export type EdgeAppearance = z.infer<typeof edgeAppearanceSchema>;
export type EdgeOverride = z.infer<typeof edgeOverrideSchema>;
export type DiagramNode = DiagramDocument['nodes'][number];
export type DiagramEdge = DiagramDocument['edges'][number];
export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
export function nodeAppearance(
  node: DiagramNode,
  definition: NotationDocument['nodeTypes'][number],
): NodeAppearance {
  return {
    ...definition.appearance,
    ...node.appearance,
    width: clamp(node.size?.width ?? definition.appearance.width, 40, 2000),
    height: clamp(node.size?.height ?? definition.appearance.height, 30, 1600),
  };
}
export function edgeAppearance(
  appearance: EdgeAppearance,
  override?: EdgeOverride,
): EdgeAppearance {
  return {
    width: 2,
    markerSize: 18,
    routing: 'smoothstep',
    fontSize: 12,
    sourceMarker: 'none',
    ...appearance,
    ...override,
  };
}
export function lineDash(appearance: EdgeAppearance): string | undefined {
  const w = appearance.width ?? 2;
  switch (appearance.line) {
    case 'dashed':
      return `${w * 3} ${w * 2}`;
    case 'dotted':
      return `${w * 0.5} ${w * 2}`;
    case 'dash-dot':
      return `${w * 4} ${w * 2} ${w * 0.5} ${w * 2}`;
    case 'custom':
      return appearance.dashPattern?.join(' ');
    default:
      return undefined;
  }
}
export function nodeLabel(node: DiagramNode, definition: NotationDocument['nodeTypes'][number]) {
  return node.label ?? String(node.properties.title ?? definition.name);
}
export function visibleProperties(
  node: DiagramNode,
  definition: NotationDocument['nodeTypes'][number],
) {
  return definition.properties
    .filter(
      (p) =>
        p.key !== 'title' &&
        p.visible !== false &&
        node.properties[p.key] !== undefined &&
        node.properties[p.key] !== '',
    )
    .map((p) => ({
      key: p.key,
      label: p.label,
      value:
        typeof node.properties[p.key] === 'boolean'
          ? node.properties[p.key]
            ? 'Да'
            : 'Нет'
          : String(node.properties[p.key]),
    }));
}
export function moveLayer(
  nodes: DiagramNode[],
  id: string,
  direction: 'front' | 'back' | 'forward' | 'backward',
): DiagramNode[] {
  const ordered = [...nodes].sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0));
  const index = ordered.findIndex((n) => n.id === id);
  if (index < 0) return nodes;
  const target =
    direction === 'front'
      ? ordered.length - 1
      : direction === 'back'
        ? 0
        : clamp(index + (direction === 'forward' ? 1 : -1), 0, ordered.length - 1);
  if (target === index) return nodes;
  const [node] = ordered.splice(index, 1);
  ordered.splice(target, 0, node);
  const layers = new Map(ordered.map((n, i) => [n.id, i]));
  return nodes.map((n) => ({ ...n, layer: layers.get(n.id)! }));
}
export function shapePoints(base: CustomShape['baseShape']): CustomShape['points'] {
  if (base === 'diamond')
    return [
      { x: 50, y: 0 },
      { x: 100, y: 50 },
      { x: 50, y: 100 },
      { x: 0, y: 50 },
    ];
  if (base === 'ellipse')
    return Array.from({ length: 16 }, (_, i) => ({
      x: 50 + 50 * Math.cos((i * Math.PI) / 8),
      y: 50 + 50 * Math.sin((i * Math.PI) / 8),
    }));
  return [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
}
export function shapePath(shape: CustomShape, width: number, height: number): string {
  const points = shape.points.map((p) => ({ x: (p.x / 100) * width, y: (p.y / 100) * height }));
  const f = shape.rounding / 100;
  const corners = points.map((p, i) => {
    const prev = points[(i + points.length - 1) % points.length],
      next = points[(i + 1) % points.length];
    return {
      p,
      in: { x: p.x + (prev.x - p.x) * f, y: p.y + (prev.y - p.y) * f },
      out: { x: p.x + (next.x - p.x) * f, y: p.y + (next.y - p.y) * f },
    };
  });
  const last = corners[corners.length - 1].out;
  return `M ${last.x} ${last.y} ${corners.map((c) => `L ${c.in.x} ${c.in.y} Q ${c.p.x} ${c.p.y} ${c.out.x} ${c.out.y}`).join(' ')} Z`;
}

export function contrastColor(fill: string) {
  const r = parseInt(fill.slice(1, 3), 16),
    g = parseInt(fill.slice(3, 5), 16),
    b = parseInt(fill.slice(5, 7), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#242635' : '#f8fafc';
}
