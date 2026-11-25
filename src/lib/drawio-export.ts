import { edgeGeometry } from './diagram-geometry';
import {
  contrastColor,
  edgeAppearance,
  lineDash,
  nodeAppearance,
  nodeLabel,
  shapePath,
  visibleProperties,
  type CustomShape,
} from './appearance';
import {
  displayedView,
  objectSnapshotSchema,
  participantId,
  relationSnapshotSchema,
  resolveInheritance,
  type ModelObject,
  type ViewDocument,
} from './model';

// Attribute values are XML, never HTML. Keep newlines and prevent invalid XML control characters.
function xml(value: unknown) {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF\uD800-\uDFFF]/gu, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replaceAll('\r', '&#13;')
    .replaceAll('\n', '&#10;')
    .replaceAll('\t', '&#9;');
}
const attributes = (values: Record<string, unknown>) =>
  Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ` ${key}="${xml(value)}"`)
    .join('');
const style = (values: Record<string, string | number>) =>
  Object.entries(values)
    .map(([key, value]) => `${key}=${value};`)
    .join('');
const nodeId = (id: string) => `node_${id}`;
const edgeId = (id: string) => `edge_${id}`;
const point = (as: string | undefined, p: { x: number; y: number }) =>
  `<mxPoint${attributes({ x: p.x, y: p.y, as })}/>`;
function userObject(id: string, label: string, data: Record<string, unknown>, cell: string) {
  return `<object${attributes({ id, label, ...data })}>${cell}</object>`;
}

// draw.io's inline stencil format: base64(raw-deflate(encodeURIComponent(stencil XML))).
async function stencil(shape: CustomShape) {
  const tags: Record<string, string> = { M: 'move', L: 'line', Q: 'quad', Z: 'close' };
  const path = [...shapePath(shape, 100, 100).matchAll(/([MLQZ])([^MLQZ]*)/g)]
    .map(([, command, coords]) => {
      const values = coords.trim().split(/\s+/).filter(Boolean).map(Number);
      const names = command === 'Q' ? ['x1', 'y1', 'x2', 'y2'] : ['x', 'y'];
      return `<${tags[command]}${attributes(Object.fromEntries(values.map((v, i) => [names[i], v])))}/>`;
    })
    .join('');
  const definition = `<shape name="maket" w="100" h="100" aspect="variable" strokewidth="inherit"><foreground><path>${path}</path><fillstroke/></foreground></shape>`;
  const compressed = new Blob([encodeURIComponent(definition)])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(compressed).arrayBuffer());
  return `stencil(${btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))})`;
}
function marker(value: string | undefined) {
  switch (value) {
    case 'arrow':
    case 'thick-arrow':
      return { shape: 'classic', fill: 1 };
    case 'thin-arrow':
      return { shape: 'open', fill: 0 };
    case 'triangle':
      return { shape: 'block', fill: 1 };
    case 'hollow-triangle':
      return { shape: 'block', fill: 0 };
    case 'diamond':
      return { shape: 'diamond', fill: 1 };
    case 'hollow-diamond':
      return { shape: 'diamond', fill: 0 };
    case 'circle':
      return { shape: 'oval', fill: 1 };
    default:
      return { shape: 'none', fill: 0 };
  }
}

/** Uncompressed mxfile, importable by draw.io without a server or a third-party converter. */
export async function drawioXml(name: string, document: ViewDocument, objects: ModelObject[]) {
  const resolved = new Map(
    resolveInheritance(objects, document.relations ?? []).map((o) => [o.id, o]),
  );
  const d: ViewDocument = { ...document, ...displayedView(document, objects) };
  const geometry = edgeGeometry(d);
  const cells: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const edges: string[] = [];
  const rendered = new Map<string, string>();
  const stencils = new Map<string, string>();
  for (const shape of d.notation.shapes ?? [])
    if (
      d.nodes.some(
        (n) =>
          nodeAppearance(
            n,
            d.notation.nodeTypes.find((t) => t.id === n.typeId)!,
          ).shapeId === shape.id,
      )
    )
      stencils.set(shape.id, await stencil(shape));
  for (const n of [...d.nodes].sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0))) {
    const cellStart = cells.length;
    const type = d.notation.nodeTypes.find((t) => t.id === n.typeId)!;
    const a = nodeAppearance(n, type);
    const object = resolved.get(n.objectId ?? '');
    const original = document.nodes.find((node) => node.id === n.id)!;
    const label = [
      ...(n.instanceOf ? ['«instance»'] : []),
      nodeLabel(n, type),
      ...(a.showAttributes === false
        ? []
        : visibleProperties(n, type).map((p) => `${p.label}: ${p.value}`)),
    ].join('\n');
    const common = {
      html: 0,
      whiteSpace: 'wrap',
      overflow: 'hidden',
      fontSize: a.fontSize ?? 12,
      fontColor: a.shape === 'text' ? '#232334' : contrastColor(a.fill),
      align: a.textAlign ?? 'center',
      verticalAlign: a.textVerticalAlign ?? 'middle',
      labelPosition: a.textPosition?.horizontal ?? 'center',
      verticalLabelPosition: a.textPosition?.vertical ?? 'middle',
      fontStyle:
        ((a.fontWeight ?? 400) >= 600 ? 1 : 0) |
        (a.fontStyle === 'italic' ? 2 : 0) |
        (a.underline ? 4 : 0) |
        (a.strikethrough ? 8 : 0),
      ...(a.fontFamily ? { fontFamily: a.fontFamily } : {}),
      spacing: 0,
      spacingTop: a.textPadding?.top ?? 8,
      spacingRight: a.textPadding?.right ?? 12,
      spacingBottom: a.textPadding?.bottom ?? 8,
      spacingLeft: a.textPadding?.left ?? 12,
    };
    const styles = {
      ...common,
      shape:
        a.shape === 'custom'
          ? (stencils.get(a.shapeId ?? '') ?? 'rectangle')
          : a.shape === 'diamond'
            ? 'rhombus'
            : a.shape === 'ellipse'
              ? 'ellipse'
              : 'rectangle',
      rounded: a.shape === 'rounded' ? 1 : 0,
      fillColor: a.shape === 'text' ? 'none' : a.fill,
      strokeColor: a.shape === 'text' ? 'none' : a.stroke,
      strokeWidth: a.strokeWidth ?? 2,
      ...(a.textRotation ? { noLabel: 1 } : {}),
    };
    cells.push(
      userObject(
        nodeId(n.id),
        label,
        {
          maket_object_id: n.objectId,
          maket_representation_id: n.id,
          maket_type: n.typeId,
          maket_name: object?.name,
          maket_description: object?.description,
          maket_attributes: JSON.stringify(n.attributes ?? {}),
          maket_properties: JSON.stringify(n.properties),
          maket_object: object ? JSON.stringify(objectSnapshotSchema.parse(object)) : undefined,
          maket_representation: JSON.stringify(original),
          ...Object.fromEntries(
            Object.entries(n.attributes ?? {}).map(([key, value]) => [`attribute_${key}`, value]),
          ),
        },
        `<mxCell${attributes({ vertex: 1, parent: '1', style: style(styles) })}><mxGeometry${attributes({ ...n.position, width: a.width, height: a.height, as: 'geometry' })}>${a.textOffset ? point('offset', a.textOffset) : ''}</mxGeometry></mxCell>`,
      ),
    );
    // A transparent child text cell rotates the label without rotating its shape or connection ports.
    if (a.textRotation)
      cells.push(
        `<mxCell${attributes({ id: `label_${n.id}`, value: label, vertex: 1, connectable: 0, parent: nodeId(n.id), style: style({ ...common, shape: 'rectangle', fillColor: 'none', strokeColor: 'none', rotation: a.textRotation }) })}><mxGeometry x="0.5" y="0.5" relative="1"${attributes({ width: a.width, height: a.height, as: 'geometry' })}>${point('offset', { x: -a.width / 2 + (a.textOffset?.x ?? 0), y: -a.height / 2 + (a.textOffset?.y ?? 0) })}</mxGeometry></mxCell>`,
      );
    rendered.set(n.id, cells.slice(cellStart).join(''));
  }
  for (const e of d.edges) {
    const type = d.notation.edgeTypes.find((t) => t.id === e.typeId)!;
    const a = edgeAppearance(type.appearance, e.appearance);
    const relation = document.relations?.find((r) => r.id === e.relationId);
    const g = geometry.get(e.id);
    if (!g) throw new Error('Не удалось определить геометрию связи');
    const start = marker(a.sourceMarker),
      end = marker(a.targetMarker);
    const styles: Record<string, string | number> = {
      html: 0,
      rounded: 1,
      fontSize: a.fontSize ?? 12,
      fontColor: '#232334',
      fontStyle:
        ((a.fontWeight ?? 400) >= 600 ? 1 : 0) |
        (a.fontStyle === 'italic' ? 2 : 0) |
        (a.underline ? 4 : 0) |
        (a.strikethrough ? 8 : 0),
      ...(a.fontFamily ? { fontFamily: a.fontFamily } : {}),
      labelBackgroundColor: '#ffffff',
      strokeColor: a.color,
      strokeWidth: a.width ?? 2,
      startArrow: start.shape,
      startFill: start.fill,
      endArrow: end.shape,
      endFill: end.fill,
      startSize: a.markerSize ?? 18,
      endSize: a.markerSize ?? 18,
      ...(!e.waypoints && a.routing === 'smoothstep'
        ? { edgeStyle: 'orthogonalEdgeStyle' }
        : !e.waypoints && a.routing === 'bezier'
          ? { edgeStyle: 'orthogonalEdgeStyle', curved: 1 }
          : {}),
      ...(e.waypoints && a.routing === 'bezier' ? { curved: 1 } : {}),
      ...(a.line !== 'solid' ? { dashed: 1, dashPattern: lineDash(a) ?? '6 3', fixDash: 1 } : {}),
    };
    const ends: Record<string, string | undefined> = {};
    for (const side of ['source', 'target'] as const) {
      const detached = side === 'source' ? e.detachedSource : e.detachedTarget;
      if (detached) continue;
      const node = d.nodes.find((n) => n.id === e[side]);
      ends[side] = node ? nodeId(e[side]) : edgeId(e[side]);
      if (node) {
        const size = nodeAppearance(
          node,
          d.notation.nodeTypes.find((t) => t.id === node.typeId)!,
        );
        const prefix = side === 'source' ? 'exit' : 'entry';
        styles[`${prefix}X`] = (g[side].x - node.position.x) / size.width;
        styles[`${prefix}Y`] = (g[side].y - node.position.y) / size.height;
        styles[`${prefix}Perimeter`] = 0;
      }
    }
    edges.push(
      userObject(
        edgeId(e.id),
        String(e.properties.label ?? ''),
        {
          maket_relation_id: e.relationId,
          maket_representation_id: e.id,
          maket_type: e.typeId,
          maket_name: relation?.name,
          maket_description: relation?.description,
          maket_source_id: relation?.sourceId ?? participantId(document, e.source),
          maket_target_id: relation?.targetId ?? participantId(document, e.target),
          maket_attributes: JSON.stringify(e.attributes ?? {}),
          maket_properties: JSON.stringify(e.properties),
          maket_relation: relation
            ? JSON.stringify(relationSnapshotSchema.parse(relation))
            : undefined,
          maket_representation: JSON.stringify(document.edges.find((edge) => edge.id === e.id)),
          ...Object.fromEntries(
            Object.entries(e.attributes ?? {}).map(([key, value]) => [`attribute_${key}`, value]),
          ),
        },
        `<mxCell${attributes({ edge: 1, parent: '1', ...ends, style: style(styles) })}><mxGeometry${attributes({ relative: e.labelPosition?.relative === false ? 0 : 1, x: e.labelPosition ? (e.labelPosition.along - 0.5) * 2 : undefined, y: e.labelPosition?.normal, as: 'geometry' })}>${point('sourcePoint', g.source)}${point('targetPoint', g.target)}${e.waypoints ? `<Array as="points">${e.waypoints.map((p) => point(undefined, p)).join('')}</Array>` : ''}${e.labelPosition ? point('offset', e.labelPosition.offset) : ''}</mxGeometry></mxCell>`,
      ),
    );
  }
  for (let i = 0; i < d.edges.length; i++) rendered.set(d.edges[i].id, edges[i]);
  const ordered = [...d.edges, ...d.nodes].sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="app.diagrams.net" agent="maket"><diagram${attributes({ id: 'maket-diagram', name })}><mxGraphModel grid="1" gridSize="10" page="0" math="0" shadow="0"><root>${[...cells.slice(0, 2), ...ordered.map((item) => rendered.get(item.id))].join('')}</root></mxGraphModel></diagram></mxfile>`;
}
