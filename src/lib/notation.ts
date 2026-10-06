import { z } from 'zod';
import {
  nodeAppearanceSchema,
  nodeOverrideSchema,
  edgeAppearanceSchema,
  edgeOverrideSchema,
  shapeSchema,
} from './appearance';
const identifier = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+$/)
  .max(100);
const property = z.object({
  key: identifier,
  label: z.string().min(1).max(100),
  type: z.enum(['string', 'number', 'boolean']),
  required: z.boolean().default(false),
  visible: z.boolean().optional(),
  scope: z.enum(['object', 'representation']).optional(),
  objectKey: identifier.optional(),
  default: z.union([z.string().max(2000), z.number().finite(), z.boolean()]).optional(),
});
export const notationSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identifier,
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    name: z.string().min(1).max(100),
    description: z.string().max(2000).default(''),
    shapes: z.array(shapeSchema).max(50).optional(),
    nodeTypes: z
      .array(
        z.object({
          id: identifier,
          name: z.string().min(1).max(100),
          appearance: nodeAppearanceSchema,
          properties: z.array(property).max(30),
          ports: z
            .array(
              z.object({
                id: identifier,
                direction: z.enum(['input', 'output']),
                maxConnections: z.number().int().positive().optional(),
              }),
            )
            .max(20),
        }),
      )
      .min(1)
      .max(50),
    edgeTypes: z
      .array(
        z.object({
          id: identifier,
          name: z.string().min(1).max(100),
          appearance: edgeAppearanceSchema,
          properties: z.array(property).max(30).default([]),
        }),
      )
      .min(1)
      .max(20),
    connectionRules: z
      .array(
        z.object({
          edgeType: identifier,
          source: z.object({ nodeType: identifier, port: identifier }),
          target: z.object({ nodeType: identifier, port: identifier }),
          allowSelfLoop: z.boolean().default(false),
        }),
      )
      .max(1000),
  })
  .superRefine((n, ctx) => {
    const error = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (new Set(n.nodeTypes.map((x) => x.id)).size !== n.nodeTypes.length)
      error('Идентификаторы элементов должны быть уникальны');
    if (new Set(n.edgeTypes.map((x) => x.id)).size !== n.edgeTypes.length)
      error('Идентификаторы связей должны быть уникальны');
    if (new Set((n.shapes ?? []).map((s) => s.id)).size !== (n.shapes ?? []).length)
      error('Идентификаторы форм должны быть уникальны');
    for (const node of n.nodeTypes) {
      if (
        node.appearance.shape === 'custom' &&
        !(n.shapes ?? []).some((s) => s.id === node.appearance.shapeId)
      )
        error(`Неизвестная пользовательская форма: ${node.id}`);
      if (new Set(node.ports.map((x) => x.id)).size !== node.ports.length)
        error(`Повторяющиеся порты: ${node.id}`);
      if (new Set(node.properties.map((x) => x.key)).size !== node.properties.length)
        error(`Повторяющиеся свойства: ${node.id}`);
    }
    for (const type of [...n.nodeTypes, ...n.edgeTypes])
      for (const p of type.properties)
        if (p.default !== undefined && typeof p.default !== p.type)
          error(`Неверное значение по умолчанию: ${p.key}`);
    for (const e of n.edgeTypes) {
      if (e.appearance.line === 'custom' && !e.appearance.dashPattern)
        error('Для пользовательской линии задайте dashPattern');
      if (new Set(e.properties.map((x) => x.key)).size !== e.properties.length)
        error(`Повторяющиеся свойства: ${e.id}`);
    }
    for (const rule of n.connectionRules) {
      if (!n.edgeTypes.some((x) => x.id === rule.edgeType))
        error('Правило ссылается на неизвестную связь');
      if (
        !n.nodeTypes
          .find((x) => x.id === rule.source.nodeType)
          ?.ports.some((x) => x.id === rule.source.port && x.direction === 'output')
      )
        error('Неизвестный выходной порт');
      if (
        !n.nodeTypes
          .find((x) => x.id === rule.target.nodeType)
          ?.ports.some((x) => x.id === rule.target.port && x.direction === 'input')
      )
        error('Неизвестный входной порт');
    }
  });
export type NotationDocument = z.infer<typeof notationSchema>;
const values = z.record(
  z.string().max(100),
  z.union([z.string().max(2000), z.number().finite(), z.boolean()]),
);
export const diagramSchema = z.object({
  schemaVersion: z.literal(1),
  notation: notationSchema,
  nodes: z
    .array(
      z.object({
        id: identifier,
        typeId: identifier,
        objectId: identifier.optional(),
        profiles: z.record(z.string().max(201), values).optional(),
        size: z
          .object({ width: z.number().min(40).max(2000), height: z.number().min(30).max(1600) })
          .optional(),
        layer: z.number().int().min(-1000000).max(1000000).optional(),
        label: z.string().max(2000).optional(),
        appearance: nodeOverrideSchema.optional(),
        position: z.object({ x: z.number().finite(), y: z.number().finite() }),
        properties: values,
      }),
    )
    .max(1000),
  edges: z
    .array(
      z.object({
        id: identifier,
        typeId: identifier,
        source: identifier,
        target: identifier,
        appearance: edgeOverrideSchema.optional(),
        sourcePort: identifier,
        targetPort: identifier,
        properties: values,
      }),
    )
    .max(3000),
});
export type DiagramDocument = z.infer<typeof diagramSchema>;
export function diagramErrors(d: DiagramDocument): string[] {
  const errors: string[] = [];
  if (new Set(d.nodes.map((x) => x.id)).size !== d.nodes.length)
    errors.push('Повторяющиеся идентификаторы элементов');
  if (new Set(d.edges.map((x) => x.id)).size !== d.edges.length)
    errors.push('Повторяющиеся идентификаторы связей');
  const check = (
    props: Record<string, unknown>,
    definitions: NotationDocument['nodeTypes'][number]['properties'],
    name: string,
  ) => {
    for (const key of Object.keys(props))
      if (!definitions.some((p) => p.key === key))
        errors.push(`${name}: неизвестное свойство ${key}`);
    for (const p of definitions) {
      const v = props[p.key];
      if (p.required && (v === undefined || v === ''))
        errors.push(`${name}: заполните «${p.label}»`);
      else if (v !== undefined && typeof v !== p.type)
        errors.push(`${name}: неверный тип «${p.label}»`);
    }
  };
  for (const node of d.nodes) {
    const type = d.notation.nodeTypes.find((x) => x.id === node.typeId);
    if (!type) errors.push('Неизвестный тип элемента');
    else {
      check(node.properties, type.properties, node.id);
      const appearance = { ...type.appearance, ...node.appearance };
      if (
        appearance.shape === 'custom' &&
        !d.notation.shapes?.some((s) => s.id === appearance.shapeId)
      )
        errors.push('Неизвестная пользовательская форма элемента');
    }
  }
  for (const edge of d.edges) {
    const type = d.notation.edgeTypes.find((x) => x.id === edge.typeId);
    if (!type) {
      errors.push('Неизвестный тип связи');
      continue;
    }
    check(edge.properties, type.properties, edge.id);
    const appearance = { ...type.appearance, ...edge.appearance };
    if (appearance.line === 'custom' && !appearance.dashPattern)
      errors.push('Для пользовательской линии задайте dashPattern');
    const source = d.nodes.find((x) => x.id === edge.source),
      target = d.nodes.find((x) => x.id === edge.target);
    if (!source || !target) {
      errors.push('Связь ссылается на отсутствующий элемент');
      continue;
    }
    if (
      !d.notation.connectionRules.some(
        (r) =>
          r.edgeType === edge.typeId &&
          r.source.nodeType === source.typeId &&
          r.target.nodeType === target.typeId &&
          r.source.port === edge.sourcePort &&
          r.target.port === edge.targetPort &&
          (edge.source !== edge.target || r.allowSelfLoop),
      )
    )
      errors.push('Соединение запрещено правилами нотации');
  }
  for (const node of d.nodes)
    for (const port of d.notation.nodeTypes.find((t) => t.id === node.typeId)?.ports ?? []) {
      if (
        port.maxConnections !== undefined &&
        d.edges.filter((e) =>
          port.direction === 'output'
            ? e.source === node.id && e.sourcePort === port.id
            : e.target === node.id && e.targetPort === port.id,
        ).length > port.maxConnections
      )
        errors.push(`Превышено число связей порта ${port.id}`);
    }
  return errors;
}
export function defaults(properties: NotationDocument['nodeTypes'][number]['properties']) {
  return Object.fromEntries(
    properties.filter((p) => p.default !== undefined).map((p) => [p.key, p.default!]),
  );
}
export const builtinNotation: NotationDocument = notationSchema.parse({
  schemaVersion: 1,
  id: 'flowchart',
  version: '1.0.0',
  name: 'Блок-схема',
  description: 'Процессы, условия и события. Универсальная нотация для описания алгоритмов.',
  nodeTypes: [
    {
      id: 'event',
      name: 'Начало / конец',
      appearance: { shape: 'ellipse', width: 150, height: 60, fill: '#ecfdf5', stroke: '#059669' },
      properties: [
        { key: 'title', label: 'Название', type: 'string', required: true, default: 'Начало' },
      ],
      ports: [
        { id: 'in', direction: 'input' },
        { id: 'out', direction: 'output' },
      ],
    },
    {
      id: 'process',
      name: 'Процесс',
      appearance: { shape: 'rounded', width: 180, height: 80, fill: '#eef2ff', stroke: '#6366f1' },
      properties: [
        { key: 'title', label: 'Название', type: 'string', required: true, default: 'Процесс' },
        { key: 'description', label: 'Описание', type: 'string', default: '' },
      ],
      ports: [
        { id: 'in', direction: 'input' },
        { id: 'out', direction: 'output' },
      ],
    },
    {
      id: 'decision',
      name: 'Условие',
      appearance: { shape: 'diamond', width: 150, height: 100, fill: '#fffbeb', stroke: '#d97706' },
      properties: [
        { key: 'title', label: 'Условие', type: 'string', required: true, default: 'Условие?' },
      ],
      ports: [
        { id: 'in', direction: 'input' },
        { id: 'yes', direction: 'output', maxConnections: 1 },
        { id: 'no', direction: 'output', maxConnections: 1 },
      ],
    },
  ],
  edgeTypes: [
    {
      id: 'flow',
      name: 'Переход',
      appearance: { line: 'solid', targetMarker: 'arrow', color: '#64748b' },
      properties: [{ key: 'label', label: 'Подпись', type: 'string', default: '' }],
    },
  ],
  connectionRules: ['event', 'process', 'decision'].flatMap((source) =>
    ['event', 'process', 'decision'].flatMap((target) =>
      (source === 'decision' ? ['yes', 'no'] : ['out']).map((port) => ({
        edgeType: 'flow',
        source: { nodeType: source, port },
        target: { nodeType: target, port: 'in' },
        allowSelfLoop: false,
      })),
    ),
  ),
});
