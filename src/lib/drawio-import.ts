import {
  attributesSchema,
  modelDiagramSchema,
  modelErrors,
  type ModelDocument,
  type ModelObject,
  type ModelRelation,
} from './model';
import { notationSchema, type NotationDocument } from './notation';
import { shapeSchema, type CustomShape, type EdgeOverride, type NodeOverride } from './appearance';
import { pointOnRoute, type Point } from './diagram-geometry';
import { hasSafeJsonDepth } from './json-depth';
const LIMIT = 2_000_000;
type Data = Record<string, unknown>;
type Cell = {
  id: string;
  cell: Element;
  data: Element;
  style: Record<string, string>;
  geometry: Element | null;
};
const record = (value: unknown): Data =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Data) : {};
const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const scalar = (v: unknown): v is string | number | boolean =>
  typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
const uuid = () => crypto.randomUUID();
const finite = (value: string | null | undefined, fallback = 0) =>
  value == null || value === '' || !Number.isFinite(Number(value)) ? fallback : Number(value);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export type DrawioDom = {
  document: Document;
  parseXml: (value: string) => Document;
  serialize: (element: Element) => string;
};
function parseXml(value: string, dom?: DrawioDom) {
  if (value.length > LIMIT) throw new Error('Распакованный XML превышает 2 МБ');
  if (/<!DOCTYPE|<!ENTITY/i.test(value)) throw new Error('DTD и XML-сущности не поддерживаются');
  const doc = dom ? dom.parseXml(value) : new DOMParser().parseFromString(value, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Некорректный XML draw.io');
  return doc;
}
function jsonAttribute(element: Element, key: string): Data {
  const value = element.getAttribute(key);
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!hasSafeJsonDepth(parsed)) throw new Error();
    return record(parsed);
  } catch {
    throw new Error(`Некорректные метаданные ${key}`);
  }
}
function plain(value: string, html: boolean, dom?: DrawioDom) {
  if (!html) return value;
  // Template contents remain inert: imported images, scripts and handlers never enter the live DOM.
  const template = (dom?.document ?? document).createElement('template');
  template.innerHTML = value.replace(/<br\s*\/?\s*>|<\/(?:div|p|tr|li|h[1-6])\s*>/gi, '\n');
  template.content.querySelectorAll('script,style,iframe,object').forEach((el) => el.remove());
  return (template.content.textContent ?? '').trimEnd();
}
async function inflate(encoded: string) {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(atob(encoded.replace(/\s/g, '')), (c) => c.charCodeAt(0));
  } catch {
    throw new Error('Некорректные сжатые данные draw.io');
  }
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LIMIT) {
        await reader.cancel();
        throw new Error('Распакованные данные превышают 2 МБ');
      }
      chunks.push(value);
    }
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    return decodeURIComponent(new TextDecoder('utf-8', { fatal: true }).decode(joined));
  } finally {
    reader.releaseLock();
  }
}
function parseStyle(value: string) {
  return Object.fromEntries(
    value
      .split(';')
      .filter(Boolean)
      .map((entry) => {
        const i = entry.indexOf('=');
        return i < 0 ? [entry, '1'] : [entry.slice(0, i), entry.slice(i + 1)];
      }),
  );
}
function color(value: string | undefined, fallback: string) {
  if (value && /^#[\da-f]{6}$/i.test(value)) return value;
  if (value && /^#[\da-f]{3}$/i.test(value))
    return '#' + [...value.slice(1)].map((c) => c + c).join('');
  return (
    (
      {
        black: '#000000',
        white: '#ffffff',
        red: '#ff0000',
        blue: '#0000ff',
        green: '#008000',
      } as Record<string, string>
    )[value ?? ''] ?? fallback
  );
}
function marker(
  value: string | undefined,
  fill: string | undefined,
): NonNullable<EdgeOverride['targetMarker']> {
  if (!value || value === 'none') return 'none';
  if (value.startsWith('open')) return 'thin-arrow';
  if (value.startsWith('block')) return fill === '0' ? 'hollow-triangle' : 'triangle';
  if (value.startsWith('diamond')) return fill === '0' ? 'hollow-diamond' : 'diamond';
  if (value.startsWith('oval')) return 'circle';
  return 'arrow';
}
async function customShape(
  encoded: string,
  id: string,
  unpack: (value: string) => Promise<string>,
  dom?: DrawioDom,
): Promise<CustomShape | undefined> {
  const def = parseXml(await unpack(encoded), dom);
  // Maket's exported stencils use one closed path with quadratic corner control points.
  const path = def.querySelector('foreground > path');
  if (!path || def.querySelectorAll('path').length !== 1) return;
  if ([...path.children].some((el) => !['move', 'line', 'quad', 'close'].includes(el.tagName)))
    return;
  const quads = [...path.children].filter((el) => el.tagName === 'quad');
  const points = quads.length
    ? quads.map((el) => ({ x: finite(el.getAttribute('x1')), y: finite(el.getAttribute('y1')) }))
    : [...path.children]
        .filter((el) => el.tagName === 'move' || el.tagName === 'line')
        .map((el) => ({ x: finite(el.getAttribute('x')), y: finite(el.getAttribute('y')) }));
  let rounding = 0;
  if (quads.length > 1) {
    const a = points[0],
      b = points[1];
    const axis = Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? 'x' : 'y';
    rounding = (100 * (finite(quads[0].getAttribute(axis + '2')) - a[axis])) / (b[axis] - a[axis]);
  }
  const parsed = shapeSchema.safeParse({
    id,
    name: 'Форма draw.io',
    baseShape: 'rectangle',
    points,
    rounding,
  });
  return parsed.success ? parsed.data : undefined;
}

export async function importDrawio(
  file: File,
  dom?: DrawioDom,
): Promise<{
  folderName: string;
  pages: { name: string; document: ModelDocument }[];
  warnings: string[];
}> {
  if (file.size > LIMIT) throw new Error('Максимальный размер файла — 2 МБ');
  const doc = parseXml(await file.text(), dom);
  const folderName = (file.name.replace(/\.(drawio|xml)$/i, '').trim() || 'Импорт draw.io').slice(
    0,
    100,
  );
  const entries =
    doc.documentElement.tagName === 'mxGraphModel'
      ? [doc.documentElement]
      : doc.documentElement.tagName === 'mxfile'
        ? [...doc.documentElement.children].filter((el) => el.tagName === 'diagram')
        : [];
  if (!entries.length || entries.length > 20)
    throw new Error('Файл должен содержать от 1 до 20 страниц draw.io');
  const warnings = new Set<string>();
  const ids = new Map<string, string>(),
    used = new Set<string>();
  const identity = (key: string, original: string) => {
    if (!ids.has(key)) {
      const id = /^[a-zA-Z0-9_-]{1,100}$/.test(original) && !used.has(original) ? original : uuid();
      used.add(id);
      ids.set(key, id);
    }
    return ids.get(key)!;
  };
  let expanded = 0,
    total = 0;
  const unpack = async (value: string) => {
    const result = await inflate(value);
    expanded += new TextEncoder().encode(result).length;
    if (expanded + total > LIMIT)
      throw new Error('Общий размер распакованных данных превышает 2 МБ');
    return result;
  };
  const pages = [];
  for (const [pageIndex, entry] of entries.entries()) {
    let model: Element | null =
      entry.tagName === 'mxGraphModel' ? entry : entry.querySelector(':scope > mxGraphModel');
    if (!model) {
      const value = entry.textContent?.trim() ?? '';
      const unpacked = value.startsWith('<') ? value : await inflate(value);
      model = parseXml(unpacked, dom).documentElement;
    }
    if (model.tagName !== 'mxGraphModel') throw new Error('На странице отсутствует mxGraphModel');
    total += new TextEncoder().encode(
      dom ? dom.serialize(model) : new XMLSerializer().serializeToString(model),
    ).length;
    if (total + expanded > LIMIT)
      throw new Error('Общий размер распакованных страниц превышает 2 МБ');
    const root = model.querySelector(':scope > root');
    if (!root) throw new Error('На странице отсутствует корень графа');
    const cells = new Map<string, Cell>();
    for (const el of root.children) {
      const cell = el.tagName === 'mxCell' ? el : el.querySelector(':scope > mxCell');
      if (!cell) continue;
      const id = el.getAttribute('id') || cell.getAttribute('id');
      if (!id || cells.has(id)) throw new Error('Пустой или повторяющийся ID ячейки draw.io');
      cells.set(id, {
        id,
        cell,
        data: el,
        style: parseStyle(cell.getAttribute('style') ?? ''),
        geometry: cell.querySelector(':scope > mxGeometry'),
      });
    }
    if (cells.size > 5000) throw new Error('Слишком много элементов на странице');
    const layers = new Map([...cells.keys()].map((id, index) => [id, index]));
    const auxiliary = (c: Cell) => {
      const parent = cells.get(c.cell.getAttribute('parent') ?? '');
      return (
        !!parent &&
        ((parent.cell.getAttribute('edge') === '1' && c.cell.getAttribute('connectable') === '0') ||
          (c.id === `label_${parent.data.getAttribute('maket_representation_id')}` &&
            !c.data.hasAttribute('maket_representation_id')))
      );
    };
    const vertices = [...cells.values()].filter(
      (c) => c.cell.getAttribute('vertex') === '1' && !auxiliary(c),
    );
    const lines = [...cells.values()].filter((c) => c.cell.getAttribute('edge') === '1');
    if (vertices.length > 1000 || lines.length > 3000)
      throw new Error('На странице допускается до 1000 фигур и 3000 стрелок');
    const repIds = new Map([...vertices, ...lines].map((c) => [c.id, uuid()]));
    const objectIds = new Map(
      vertices.map((c) => [
        c.id,
        identity(
          c.data.hasAttribute('maket_object_id')
            ? `object:${c.data.getAttribute('maket_object_id')}`
            : `${pageIndex}:object:${c.id}`,
          c.data.getAttribute('maket_object_id') || c.id,
        ),
      ]),
    );
    const relationIds = new Map(
      lines.map((c) => [
        c.id,
        identity(
          c.data.hasAttribute('maket_relation_id')
            ? `relation:${c.data.getAttribute('maket_relation_id')}`
            : `${pageIndex}:relation:${c.id}`,
          c.data.getAttribute('maket_relation_id') || c.id,
        ),
      ]),
    );
    const label = (c: Cell) => {
      const child = [...cells.values()].find(
        (x) => x.cell.getAttribute('parent') === c.id && auxiliary(x),
      );
      const value = child ?? c;
      return plain(
        value.data.getAttribute('label') ?? value.cell.getAttribute('value') ?? '',
        value.style.html === '1',
        dom,
      );
    };
    const position = (c: Cell, seen = new Set<string>()): { x: number; y: number } => {
      if (seen.has(c.id)) throw new Error('Цикл вложенности ячеек draw.io');
      if (seen.size >= 100) throw new Error('Слишком большая вложенность групп draw.io');
      seen.add(c.id);
      const parent = cells.get(c.cell.getAttribute('parent') ?? '');
      const p =
        parent?.cell.getAttribute('vertex') === '1' ? position(parent, seen) : { x: 0, y: 0 };
      const relative = c.geometry?.getAttribute('relative') === '1';
      const offset = c.geometry?.querySelector('[as="offset"]');
      const result = {
        x:
          p.x +
          finite(c.geometry?.getAttribute('x')) *
            (relative ? finite(parent?.geometry?.getAttribute('width'), 1) : 1) +
          (relative ? finite(offset?.getAttribute('x')) : 0),
        y:
          p.y +
          finite(c.geometry?.getAttribute('y')) *
            (relative ? finite(parent?.geometry?.getAttribute('height'), 1) : 1) +
          (relative ? finite(offset?.getAttribute('y')) : 0),
      };
      if (relative && parent && finite(parent.style.rotation)) {
        const angle = (finite(parent.style.rotation) * Math.PI) / 180;
        const center = {
          x: p.x + finite(parent.geometry?.getAttribute('width')) / 2,
          y: p.y + finite(parent.geometry?.getAttribute('height')) / 2,
        };
        const width = finite(c.geometry?.getAttribute('width')),
          height = finite(c.geometry?.getAttribute('height'));
        const dx = result.x + width / 2 - center.x,
          dy = result.y + height / 2 - center.y;
        result.x = center.x + dx * Math.cos(angle) - dy * Math.sin(angle) - width / 2;
        result.y = center.y + dx * Math.sin(angle) + dy * Math.cos(angle) - height / 2;
      }
      return result;
    };
    const scale = Math.min(
      1,
      ...vertices.map((c) => 2000 / Math.max(1, finite(c.geometry?.getAttribute('width'), 180))),
      ...vertices.map((c) => 1600 / Math.max(1, finite(c.geometry?.getAttribute('height'), 80))),
    );
    if (scale < 1) warnings.add('Крупные страницы уменьшены до допустимых размеров фигур.');
    const objects = new Map<string, ModelObject>(),
      relations = new Map<string, ModelRelation>();
    const originals = new Map<string, Data>();
    const types = new Map<string, NotationDocument['nodeTypes'][number]>();
    const shapes = new Map<string, CustomShape>();
    const attemptedShapes = new Set<string>();
    const nodes: ModelDocument['nodes'] = [],
      edges: ModelDocument['edges'] = [];
    const reserved = new Set([
      'id',
      'label',
      'maket_object_id',
      'maket_relation_id',
      'maket_representation_id',
      'maket_type',
      'maket_name',
      'maket_description',
      'maket_source_id',
      'maket_target_id',
      'maket_attributes',
      'maket_properties',
      'maket_object',
      'maket_relation',
      'maket_representation',
    ]);
    const sourceAttrs = (value: Data, id: string) => {
      const attrs = attributesSchema.parse(value);
      if (Object.hasOwn(attrs, 'drawio_id') || Object.keys(attrs).length < 100)
        attrs.drawio_id = id;
      else
        warnings.add(
          'У элементов со 100 атрибутами служебный drawio_id не добавлен; пользовательские значения сохранены.',
        );
      return attrs;
    };
    const objectAttrs = (c: Cell) => {
      const attrs: Data = {};
      for (const a of c.data.attributes) {
        if (
          reserved.has(a.name) ||
          (c.data.hasAttribute('maket_representation_id') && a.name.startsWith('attribute_'))
        )
          continue;
        let key = a.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 90);
        while (key in attrs) key += '_';
        attrs[key] = a.value;
      }
      for (const a of c.data.attributes)
        if (
          c.data.hasAttribute('maket_representation_id') &&
          a.name.startsWith('attribute_') &&
          !c.data.hasAttribute('maket_object') &&
          !c.data.hasAttribute('maket_relation')
        )
          attrs[a.name.slice(10)] = a.value;
      return attrs;
    };
    const localAttrs = (c: Cell, rep: Data, effective: Data) => {
      const result = {
        ...(c.data.hasAttribute('maket_representation') ? record(rep.attributes) : effective),
      };
      for (const a of c.data.attributes) {
        if (!c.data.hasAttribute('maket_representation_id') || !a.name.startsWith('attribute_'))
          continue;
        const key = a.name.slice(10),
          old = effective[key];
        const value =
          typeof old === 'boolean' && ['true', 'false'].includes(a.value)
            ? a.value === 'true'
            : typeof old === 'number' && a.value.trim() && Number.isFinite(Number(a.value))
              ? Number(a.value)
              : a.value;
        if (value !== old) result[key] = value;
      }
      return attributesSchema.parse(result);
    };
    for (const c of vertices) {
      const original = jsonAttribute(c.data, 'maket_object');
      const rep = jsonAttribute(c.data, 'maket_representation');
      const props = jsonAttribute(c.data, 'maket_properties');
      const local = jsonAttribute(c.data, 'maket_attributes');
      const objectId = objectIds.get(c.id)!;
      if (!originals.has(objectId)) originals.set(objectId, original);
      const caption = label(c);
      if (!objects.has(objectId))
        objects.set(objectId, {
          id: objectId,
          parentId: null,
          kind: 'object',
          name: (text(original.name, caption).trim() || 'Объект').slice(0, 100),
          description: text(original.description, c.data.getAttribute('maket_description') ?? ''),
          archived: false,
          revision: 1,
          attributes: sourceAttrs(
            {
              ...objectAttrs(c),
              ...record(original.inheritedAttributes),
              ...record(original.attributes),
            },
            c.id,
          ),
        });
      const propertyValues = Object.fromEntries(
        Object.entries(props).filter(([, v]) => scalar(v)),
      ) as ModelObject['attributes'];
      const signature = JSON.stringify([
        c.data.getAttribute('maket_type') ?? 'drawio',
        Object.entries(propertyValues)
          .map(([k, v]) => [k, typeof v])
          .sort(),
      ]);
      if (!types.has(signature)) {
        if (types.size >= 50) throw new Error('На странице больше 50 вариантов типов фигур');
        types.set(signature, {
          id: `node_${types.size}`,
          name: 'Элемент draw.io',
          appearance: {
            shape: 'rectangle',
            width: 180,
            height: 80,
            fill: '#ffffff',
            stroke: '#000000',
          },
          properties: Object.entries(propertyValues).map(([key, value]) => ({
            key,
            label: key,
            type: typeof value as 'string' | 'number' | 'boolean',
            required: false,
            visible: false,
            scope: 'representation',
          })),
          ports: [
            { id: 'in', direction: 'input' },
            { id: 'out', direction: 'output' },
          ],
        });
      }
      const s = c.style;
      let shape: NodeOverride['shape'] =
        s.shape === 'ellipse' || c.style.ellipse === '1'
          ? 'ellipse'
          : s.shape === 'rhombus' || s.rhombus === '1'
            ? 'diamond'
            : s.text === '1' ||
                s.shape === 'text' ||
                (s.fillColor === 'none' && s.strokeColor === 'none')
              ? 'text'
              : s.rounded === '1'
                ? 'rounded'
                : 'rectangle';
      let shapeId: string | undefined;
      if (s.shape?.startsWith('stencil(')) {
        if (!attemptedShapes.has(s.shape)) {
          attemptedShapes.add(s.shape);
          const custom = await customShape(
            s.shape.slice(8, -1),
            `shape_${shapes.size}`,
            unpack,
            dom,
          );
          if (custom) shapes.set(s.shape, custom);
        }
        shapeId = shapes.get(s.shape)?.id;
        if (shapeId) shape = 'custom';
        else warnings.add('Сложные трафареты заменены базовыми фигурами.');
      } else if (
        s.shape &&
        !['rectangle', 'ellipse', 'rhombus', 'text', 'label', 'swimlane'].includes(s.shape)
      )
        warnings.add('Некоторые специальные фигуры показаны базовыми контурами.');
      if (s.image) warnings.add('Внешние изображения не загружаются; вместо них создан объект.');
      if (s.rotation && s.rotation !== '0' && shape !== 'text')
        warnings.add('Поворот контура фигуры не поддерживается; подписи и размеры сохранены.');
      const rotated = [...cells.values()].find(
        (x) => x.cell.getAttribute('parent') === c.id && auxiliary(x),
      );
      const p = position(c);
      nodes.push({
        id: repIds.get(c.id)!,
        objectId,
        bindingId: 'drawio',
        typeId: types.get(signature)!.id,
        label: caption,
        properties: propertyValues,
        attributes: localAttrs(c, rep, local),
        position: { x: p.x * scale, y: p.y * scale },
        size: {
          width: clamp(finite(c.geometry?.getAttribute('width'), 180) * scale, 40, 2000),
          height: clamp(finite(c.geometry?.getAttribute('height'), 80) * scale, 30, 1600),
        },
        layer: layers.get(c.id),
        appearance: {
          shape,
          shapeId,
          fill: color(s.fillColor, '#ffffff'),
          stroke: color(s.strokeColor, '#000000'),
          strokeWidth: clamp(finite(s.strokeWidth, 2) * scale, 0.5, 12),
          fontSize: clamp(finite(s.fontSize, 12) * scale, 8, 72),
          textAlign: ['left', 'right'].includes(s.align) ? (s.align as 'left' | 'right') : 'center',
          showAttributes: false,
          textRotation: clamp(
            finite(
              rotated?.style.rotation,
              finite(
                record(rep.appearance).textRotation as string | undefined,
                shape === 'text' ? finite(s.rotation) : s.horizontal === '0' ? -90 : 0,
              ),
            ),
            -180,
            180,
          ),
        },
      });
    }
    const parentOrigin = (c: Cell) => {
      const parent = cells.get(c.cell.getAttribute('parent') ?? '');
      return parent?.cell.getAttribute('vertex') === '1' ? position(parent) : { x: 0, y: 0 };
    };
    const globalPoint = (c: Cell, point: Element): Point => {
      const origin = parentOrigin(c);
      return {
        x: (origin.x + finite(point.getAttribute('x'))) * scale,
        y: (origin.y + finite(point.getAttribute('y'))) * scale,
      };
    };
    const nodeFor = (id: string | null) => nodes.find((n) => n.id === repIds.get(id ?? ''));
    const terminalCenter = (
      id: string | null,
      point: Element | null | undefined,
      c: Cell,
    ): Point => {
      const n = nodeFor(id);
      if (n) return { x: n.position.x + n.size!.width / 2, y: n.position.y + n.size!.height / 2 };
      const route = edges.find((e) => e.id === repIds.get(id ?? ''));
      if (route) {
        const attachedPoint = (side: 'source' | 'target') => {
          const rawId = cells.get(id!)?.cell.getAttribute(side) ?? null;
          const terminal = nodeFor(rawId),
            point = route[side === 'source' ? 'sourceAnchor' : 'targetAnchor'];
          return terminal && point
            ? {
                x: terminal.position.x + point.x * terminal.size!.width,
                y: terminal.position.y + point.y * terminal.size!.height,
              }
            : terminalCenter(rawId, undefined, c);
        };
        const source = route.detachedSource ?? attachedPoint('source');
        const target = route.detachedTarget ?? attachedPoint('target');
        return pointOnRoute([source, ...(route.waypoints ?? []), target]);
      }
      return point ? globalPoint(c, point) : parentOrigin(c);
    };
    const anchor = (c: Cell, id: string | null, side: 'exit' | 'entry', toward: Point) => {
      const n = nodeFor(id);
      if (!n) return id && relationIds.has(id) ? { x: 0.5, y: 0.5 } : undefined;
      const terminal = cells.get(id!)!;
      const origin = position(terminal),
        width = finite(terminal.geometry?.getAttribute('width'), 180),
        height = finite(terminal.geometry?.getAttribute('height'), 80);
      const fixed = c.style[side + 'X'] !== undefined && c.style[side + 'Y'] !== undefined;
      let x = fixed ? finite(c.style[side + 'X'], 0.5) : (toward.x / scale - origin.x) / width;
      let y = fixed ? finite(c.style[side + 'Y'], 0.5) : (toward.y / scale - origin.y) / height;
      if (!fixed || c.style[side + 'Perimeter'] !== '0') {
        const dx = x - 0.5,
          dy = y - 0.5;
        const shape = n.appearance?.shape;
        const denominator =
          shape === 'ellipse'
            ? Math.hypot(dx, dy) * 2
            : shape === 'diamond'
              ? (Math.abs(dx) + Math.abs(dy)) * 2
              : Math.max(Math.abs(dx), Math.abs(dy)) * 2;
        x = denominator ? 0.5 + dx / denominator : side === 'exit' ? 1 : 0;
        y = denominator ? 0.5 + dy / denominator : 0.5;
      }
      // Representation dimensions may be clamped by maket; preserve the imported point in pixels.
      return {
        x: ((x * width + finite(c.style[side + 'Dx'])) * scale) / n.size!.width,
        y: ((y * height + finite(c.style[side + 'Dy'])) * scale) / n.size!.height,
      };
    };
    const semantic = (rawId: string | null) =>
      objectIds.get(rawId ?? '') ?? relationIds.get(rawId ?? '');
    const pending = [...lines];
    while (pending.length) {
      const index = pending.findIndex((c) =>
        [c.cell.getAttribute('source'), c.cell.getAttribute('target')].every(
          (id) => !id || !relationIds.has(id) || relations.has(relationIds.get(id)!),
        ),
      );
      if (index < 0) throw new Error('Цикл между стрелками draw.io не поддерживается');
      const [c] = pending.splice(index, 1);
      const meta = jsonAttribute(c.data, 'maket_relation'),
        rep = jsonAttribute(c.data, 'maket_representation');
      const attrs = jsonAttribute(c.data, 'maket_attributes'),
        props = jsonAttribute(c.data, 'maket_properties');
      const source = c.cell.getAttribute('source'),
        target = c.cell.getAttribute('target');
      const sourcePoint = c.geometry?.querySelector('[as="sourcePoint"]'),
        targetPoint = c.geometry?.querySelector('[as="targetPoint"]');
      const endpoint = (
        id: string | null,
        point: Element | null | undefined,
        key: 'sourceId' | 'targetId',
      ) => {
        if (id && semantic(id)) return semantic(id)!;
        const old = text(meta[key]);
        const known = [...objects.keys(), ...relations.keys()].find((value) => value === old);
        if (known) return known;
        if (!point) throw new Error(`У стрелки ${c.id} отсутствует участник или свободный конец`);
        // Free ends still need a semantic participant, represented only in the imported folder.
        const idHidden = old ? identity(`object:${old}`, old) : uuid();
        objects.set(idHidden, {
          id: idHidden,
          parentId: null,
          name: 'Свободный конец',
          description: '',
          attributes: {},
          archived: false,
          revision: 1,
        });
        return idHidden;
      };
      const sourceId = endpoint(source, sourcePoint, 'sourceId'),
        targetId = endpoint(target, targetPoint, 'targetId');
      const relationId = relationIds.get(c.id)!;
      relations.set(relationId, {
        id: relationId,
        parentId: null,
        sourceId,
        targetId,
        name: (text(meta.name, label(c)).trim() || 'Связь').slice(0, 100),
        description: text(meta.description),
        relationType: text(meta.relationType, 'draw.io'),
        archived: false,
        revision: 1,
        attributes: sourceAttrs(
          {
            ...objectAttrs(c),
            ...record(meta.attributes),
          },
          c.id,
        ),
      });
      const dash = c.style.dashPattern?.split(/\s+/).map(Number);
      const customDash =
        dash && dash.length >= 2 && dash.length <= 8 && dash.every((n) => n > 0 && n <= 50)
          ? dash
          : undefined;
      const detached = (point: Element | null | undefined) =>
        point ? globalPoint(c, point) : undefined;
      const points = c.geometry?.querySelector(':scope > Array[as="points"]');
      if (points && points.children.length > 256)
        throw new Error('У стрелки больше 256 точек маршрута');
      const controls = points
        ? [...points.children].filter((p) => p.tagName === 'mxPoint').map((p) => globalPoint(c, p))
        : [];
      const waypoints = controls.length || !c.style.edgeStyle ? controls : undefined;
      const offset = c.geometry?.querySelector(':scope > mxPoint[as="offset"]');
      const labelCell = [...cells.values()].find(
        (x) => x.cell.getAttribute('parent') === c.id && auxiliary(x),
      );
      const labelGeometry = labelCell?.geometry ?? c.geometry;
      const labelOffset = labelGeometry?.querySelector(':scope > mxPoint[as="offset"]') ?? offset;
      const labelPosition = {
        relative: labelGeometry?.getAttribute('relative') === '1',
        along: finite(labelGeometry?.getAttribute('x')) / 2 + 0.5,
        normal: finite(labelGeometry?.getAttribute('y')) * scale,
        offset: {
          x: finite(labelOffset?.getAttribute('x')) * scale,
          y: finite(labelOffset?.getAttribute('y')) * scale,
        },
      };
      const sourceAnchor = anchor(
        c,
        source,
        'exit',
        waypoints?.[0] ?? terminalCenter(target, targetPoint, c),
      );
      const targetAnchor = anchor(
        c,
        target,
        'entry',
        waypoints?.at(-1) ?? terminalCenter(source, sourcePoint, c),
      );
      edges.push({
        id: repIds.get(c.id)!,
        bindingId: null,
        typeId: 'association',
        relationId,
        source: repIds.get(source ?? '') ?? uuid(),
        target: repIds.get(target ?? '') ?? uuid(),
        sourcePort: 'out',
        targetPort: 'in',
        layer: layers.get(c.id),
        sourceAnchor,
        targetAnchor,
        waypoints,
        labelPosition,
        detachedSource: source && repIds.has(source) ? undefined : detached(sourcePoint),
        detachedTarget: target && repIds.has(target) ? undefined : detached(targetPoint),
        properties: { label: label(c) },
        attributes: attributesSchema.parse({
          ...Object.fromEntries(
            Object.entries(props)
              .filter(([key, value]) => key !== 'label' && scalar(value))
              .map(([key, value]) => [`drawio_property_${key}`, value]),
          ),
          ...localAttrs(c, rep, attrs),
        }),
        appearance: {
          color: color(c.style.strokeColor, '#64748b'),
          width: clamp(finite(c.style.strokeWidth, 2) * scale, 0.5, 12),
          fontSize: clamp(finite(c.style.fontSize, 12) * scale, 8, 48),
          line: c.style.dashed === '1' ? (customDash ? 'custom' : 'dashed') : 'solid',
          dashPattern: customDash,
          sourceMarker: marker(c.style.startArrow, c.style.startFill),
          targetMarker: marker(c.style.endArrow, c.style.endFill),
          routing:
            c.style.curved === '1' ? 'bezier' : c.style.edgeStyle ? 'smoothstep' : 'straight',
        },
      });
    }
    for (const relation of relations.values()) {
      if (!['наследует', 'экземпляр'].includes(relation.relationType ?? '')) continue;
      const target = objects.get(relation.targetId),
        original = originals.get(relation.targetId);
      if (target && original) {
        for (const key of Object.keys(record(original.inheritedAttributes)))
          if (!Object.hasOwn(record(original.attributes), key)) delete target.attributes[key];
        for (const node of nodes.filter((n) => n.objectId === target.id))
          if (relation.relationType === 'экземпляр' && node.label?.startsWith('«instance»\n'))
            node.label = node.label.slice('«instance»\n'.length);
      }
    }
    const notation = notationSchema.parse({
      schemaVersion: 1,
      id: 'drawio_import',
      name: 'Импорт draw.io',
      description: 'Редактируемые фигуры и связи из draw.io',
      version: '1.0.0',
      shapes: [...shapes.values()],
      nodeTypes: types.size
        ? [...types.values()]
        : [
            {
              id: 'node',
              name: 'Объект',
              appearance: {
                shape: 'rectangle',
                width: 180,
                height: 80,
                fill: '#ffffff',
                stroke: '#000000',
              },
              properties: [],
              ports: [
                { id: 'in', direction: 'input' },
                { id: 'out', direction: 'output' },
              ],
            },
          ],
      edgeTypes: [
        {
          id: 'association',
          name: 'Связь',
          appearance: { line: 'solid', targetMarker: 'arrow' },
          properties: [
            { key: 'label', label: 'Подпись', type: 'string', required: false, default: '' },
          ],
        },
      ],
      connectionRules:
        types.size * types.size <= 1000
          ? [...types.values()].flatMap((source) =>
              [...types.values()].map((target) => ({
                edgeType: 'association',
                source: { nodeType: source.id, port: 'out' },
                target: { nodeType: target.id, port: 'in' },
                allowSelfLoop: true,
              })),
            )
          : [...types.values()].map((type) => ({
              edgeType: 'association',
              source: { nodeType: type.id, port: 'out' },
              target: { nodeType: type.id, port: 'in' },
              allowSelfLoop: true,
            })),
    });
    const converted = modelDiagramSchema.parse({
      schemaVersion: 2,
      modelSpaceId: 'drawio_import',
      bindings: [{ id: 'drawio', versionId: null, document: notation }],
      objects: [...objects.values()],
      relations: [...relations.values()],
      nodes,
      edges,
    });
    const errors = modelErrors(converted);
    if (errors.length) throw new Error(errors.join('; '));
    pages.push({
      name: (
        entry.getAttribute('name') ||
        (entries.length === 1 ? folderName : `Страница ${pageIndex + 1}`)
      ).slice(0, 100),
      document: converted,
    });
  }
  const result = { folderName, pages, warnings: [...warnings] };
  if (new TextEncoder().encode(JSON.stringify(result)).length > LIMIT)
    throw new Error('Результат импорта превышает 2 МБ. Разделите файл на несколько частей.');
  return result;
}
