import { getBezierPath, getSmoothStepPath, getStraightPath, Position } from '@xyflow/react';
import { nodeAppearance, edgeAppearance } from './appearance';
import type { DiagramDocument } from './notation';
export type Point = { x: number; y: number };
export function pointOnRoute(
  points: Point[],
  along = 0.5,
  normal = 0,
  offset: Point = { x: 0, y: 0 },
) {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * along;
  let index = 0;
  while (index < lengths.length - 1 && remaining > lengths[index]) remaining -= lengths[index++];
  const a = points[index],
    b = points[index + 1] ?? a,
    length = lengths[index] ?? 0;
  const dx = b.x - a.x,
    dy = b.y - a.y,
    fraction = length ? remaining / length : 0;
  return {
    x: a.x + dx * fraction + (length ? (dy * normal) / length : 0) + offset.x,
    y: a.y + dy * fraction - (length ? (dx * normal) / length : 0) + offset.y,
  };
}
export type EdgeGeometry = {
  path: string;
  center: Point;
  label: Point;
  source: Point;
  target: Point;
  points: Point[];
  attachmentOffset: number;
};
function routedPath(points: Point[], curved: boolean) {
  if (!curved || points.length < 3)
    return points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const control = points[i],
      next = points[i + 1];
    const end =
      i === points.length - 2 ? next : { x: (control.x + next.x) / 2, y: (control.y + next.y) / 2 };
    path += ` Q ${control.x} ${control.y} ${end.x} ${end.y}`;
  }
  return path;
}
function anchorSide(anchor: Point) {
  const sides = [
    [Math.abs(anchor.x), Position.Left],
    [Math.abs(anchor.x - 1), Position.Right],
    [Math.abs(anchor.y), Position.Top],
    [Math.abs(anchor.y - 1), Position.Bottom],
  ] as const;
  return [...sides].sort((a, b) => a[0] - b[0])[0][1];
}
/** Resolve a pointer along a semantic port's face without changing the port or notation rules. */
export function faceAttachment(
  d: DiagramDocument,
  id: string,
  port: string | null | undefined,
  pointer?: Point | null,
) {
  const node = d.nodes.find((n) => n.id === id);
  const type = d.notation.nodeTypes.find((t) => t.id === node?.typeId);
  const definition = type?.ports.find((p) => p.id === port);
  if (!node || !type || !definition || !pointer) return;
  const a = nodeAppearance(node, type);
  const anchor = {
    x: definition.direction === 'output' ? 1 : 0,
    y: Math.max(0, Math.min(1, (pointer.y - node.position.y) / a.height)),
  };
  return {
    anchor,
    point: { x: node.position.x + anchor.x * a.width, y: node.position.y + anchor.y * a.height },
  };
}
export function edgeGeometry(d: DiagramDocument) {
  const result = new Map<string, EdgeGeometry>();
  const visiting = new Set<string>();
  function endpoint(id: string, port: string, output: boolean, anchor?: Point): Point | undefined {
    const n = d.nodes.find((n) => n.id === id);
    if (!n) {
      const g = compute(id);
      return g
        ? anchor
          ? { x: g.center.x + (anchor.x - 0.5) * 24, y: g.center.y + (anchor.y - 0.5) * 16 }
          : { x: g.center.x + (port === 'in' ? -12 : 12), y: g.center.y + g.attachmentOffset }
        : undefined;
    }
    const t = d.notation.nodeTypes.find((t) => t.id === n.typeId);
    if (!t) return;
    const a = nodeAppearance(n, t);
    if (anchor)
      return { x: n.position.x + anchor.x * a.width, y: n.position.y + anchor.y * a.height };
    const ports = t.ports.filter((p) => p.direction === (output ? 'output' : 'input'));
    const index = ports.findIndex((p) => p.id === port);
    return {
      x: n.position.x + (output ? a.width : 0),
      y: n.position.y + a.height * (index < 0 ? 0.5 : (index + 1) / (ports.length + 1)),
    };
  }
  function compute(id: string): ReturnType<typeof result.get> {
    if (result.has(id)) return result.get(id);
    if (visiting.has(id)) return;
    const e = d.edges.find((e) => e.id === id);
    if (!e) return;
    visiting.add(id);
    const source = e.detachedSource ?? endpoint(e.source, e.sourcePort, true, e.sourceAnchor),
      target = e.detachedTarget ?? endpoint(e.target, e.targetPort, false, e.targetAnchor);
    visiting.delete(id);
    if (!source || !target) return;
    const t = d.notation.edgeTypes.find((t) => t.id === e.typeId);
    if (!t) return;
    const a = edgeAppearance(t.appearance, e.appearance);
    const params = {
      sourceX: source.x,
      sourceY: source.y,
      targetX: target.x,
      targetY: target.y,
      sourcePosition: e.sourceAnchor
        ? anchorSide(e.sourceAnchor)
        : !e.detachedSource && !d.nodes.some((n) => n.id === e.source) && e.sourcePort === 'in'
          ? Position.Left
          : Position.Right,
      targetPosition: e.targetAnchor
        ? anchorSide(e.targetAnchor)
        : !e.detachedTarget && !d.nodes.some((n) => n.id === e.target) && e.targetPort === 'out'
          ? Position.Right
          : Position.Left,
    };
    const [automaticPath, x, y] =
      a.routing === 'straight'
        ? getStraightPath(params)
        : a.routing !== 'smoothstep'
          ? getBezierPath(params)
          : getSmoothStepPath(params);
    const points = [source, ...(e.waypoints ?? []), target];
    const center = e.waypoints ? pointOnRoute(points) : { x, y };
    const label = e.labelPosition
      ? e.labelPosition.relative
        ? pointOnRoute(
            points,
            e.labelPosition.along,
            e.labelPosition.normal,
            e.labelPosition.offset,
          )
        : {
            x: (source.x + target.x) / 2 + e.labelPosition.offset.x,
            y: (source.y + target.y) / 2 + e.labelPosition.offset.y,
          }
      : center;
    const geometry = {
      path: e.waypoints ? routedPath(points, a.routing === 'bezier') : automaticPath,
      center,
      label,
      points,
      source,
      target,
      attachmentOffset: (a.fontSize ?? 12) / 2 + 16,
    };
    result.set(id, geometry);
    return geometry;
  }
  for (const e of d.edges) compute(e.id);
  return result;
}
