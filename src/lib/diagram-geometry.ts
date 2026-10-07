import { getBezierPath, getSmoothStepPath, getStraightPath, Position } from '@xyflow/react';
import { nodeAppearance, edgeAppearance } from './appearance';
import type { DiagramDocument } from './notation';
type Point = { x: number; y: number };
export function edgeGeometry(d: DiagramDocument) {
  const result = new Map<
    string,
    { path: string; center: Point; source: Point; target: Point; attachmentOffset: number }
  >();
  const visiting = new Set<string>();
  function endpoint(id: string, port: string, output: boolean): Point | undefined {
    const n = d.nodes.find((n) => n.id === id);
    if (!n) {
      const g = compute(id);
      return g
        ? { x: g.center.x + (port === 'in' ? -12 : 12), y: g.center.y + g.attachmentOffset }
        : undefined;
    }
    const t = d.notation.nodeTypes.find((t) => t.id === n.typeId);
    if (!t) return;
    const a = nodeAppearance(n, t);
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
    const source = endpoint(e.source, e.sourcePort, true),
      target = endpoint(e.target, e.targetPort, false);
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
      sourcePosition:
        !d.nodes.some((n) => n.id === e.source) && e.sourcePort === 'in'
          ? Position.Left
          : Position.Right,
      targetPosition:
        !d.nodes.some((n) => n.id === e.target) && e.targetPort === 'out'
          ? Position.Right
          : Position.Left,
    };
    const [path, x, y] =
      a.routing === 'straight'
        ? getStraightPath(params)
        : a.routing !== 'smoothstep'
          ? getBezierPath(params)
          : getSmoothStepPath(params);
    const geometry = {
      path,
      center: { x, y },
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
