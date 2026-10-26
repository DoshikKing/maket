import { builtinNotation, notationSchema } from './notation';
import type { NodeAppearance } from './appearance';

function node(
  id: string,
  name: string,
  appearance: Partial<NodeAppearance> = {},
  properties: unknown[] = [],
) {
  return {
    id,
    name,
    appearance: {
      shape: 'rounded',
      width: 180,
      height: 80,
      fill: '#f0f9ff',
      stroke: '#0284c7',
      ...appearance,
    },
    properties: [
      { key: 'title', label: 'Название', type: 'string', required: true, default: name },
      ...properties,
    ],
    ports: [
      { id: 'in', direction: 'input' },
      { id: 'out', direction: 'output' },
    ],
  };
}
function edge(
  id: string,
  name: string,
  line = 'solid',
  targetMarker = 'arrow',
  sourceMarker = 'none',
) {
  return {
    id,
    name,
    appearance: { line, targetMarker, sourceMarker, color: '#475569' },
    properties: [{ key: 'label', label: 'Подпись', type: 'string', default: '' }],
  };
}
function rules(
  nodes: ReturnType<typeof node>[],
  edgeType: string,
  sources = nodes.map((n) => n.id),
  targets = nodes.map((n) => n.id),
) {
  return nodes
    .filter((n) => sources.includes(n.id) && n.ports.some((p) => p.id === 'out'))
    .flatMap((source) =>
      nodes
        .filter((n) => targets.includes(n.id) && n.ports.some((p) => p.id === 'in'))
        .map((target) => ({
          edgeType,
          source: { nodeType: source.id, port: 'out' },
          target: { nodeType: target.id, port: 'in' },
          allowSelfLoop: false,
        })),
    );
}
const bpmnNodes = [
  node('startEvent', 'Начальное событие', {
    shape: 'ellipse',
    width: 60,
    height: 60,
    fill: '#ecfdf5',
    stroke: '#059669',
  }),
  node('intermediateEvent', 'Промежуточное событие', { shape: 'ellipse', width: 60, height: 60 }),
  node('endEvent', 'Конечное событие', {
    shape: 'ellipse',
    width: 60,
    height: 60,
    fill: '#fff1f2',
    stroke: '#dc2626',
  }),
  node('task', 'Задача'),
  node('userTask', 'Пользовательская задача'),
  node('serviceTask', 'Сервисная задача', {}, [
    { key: 'automated', label: 'Авторабота', type: 'boolean', default: true, visible: true },
  ]),
  node('subProcess', 'Подпроцесс'),
  node('exclusiveGateway', 'Исключающий шлюз', {
    shape: 'diamond',
    width: 100,
    height: 100,
    fill: '#fffbeb',
    stroke: '#d97706',
  }),
  node('parallelGateway', 'Параллельный шлюз', {
    shape: 'diamond',
    width: 100,
    height: 100,
    fill: '#fffbeb',
    stroke: '#d97706',
  }),
  node('participant', 'Участник / пул', { shape: 'rectangle', width: 400, height: 180 }),
  node('dataObject', 'Данные', { shape: 'rectangle', width: 120, height: 100 }),
];
bpmnNodes[0].ports = [{ id: 'out', direction: 'output' }];
bpmnNodes[2].ports = [{ id: 'in', direction: 'input' }];
const sequence = bpmnNodes
  .filter((n) => !['participant', 'dataObject'].includes(n.id))
  .map((n) => n.id);
const messaging = ['participant', 'task', 'userTask', 'serviceTask', 'intermediateEvent'];
const bpmn = notationSchema.parse({
  schemaVersion: 1,
  id: 'bpmn',
  version: '1.0.0',
  name: 'BPMN',
  description: 'Базовые элементы BPMN: события, задачи, подпроцессы, шлюзы, участники и данные.',
  nodeTypes: bpmnNodes,
  edgeTypes: [
    edge('sequenceFlow', 'Поток управления'),
    edge('messageFlow', 'Поток сообщений', 'dashed', 'thin-arrow', 'circle'),
    edge('association', 'Ассоциация данных', 'dotted', 'none'),
  ],
  connectionRules: [
    ...rules(bpmnNodes, 'sequenceFlow', sequence, sequence),
    ...rules(bpmnNodes, 'messageFlow', messaging, messaging),
    ...rules(bpmnNodes, 'association'),
  ],
});
const umlNodes = [
  node('class', 'Класс', { shape: 'rectangle', width: 220, height: 140 }, [
    { key: 'attributes', label: 'Атрибуты', type: 'string', default: '', visible: true },
    { key: 'operations', label: 'Операции', type: 'string', default: '', visible: true },
    { key: 'abstract', label: 'Абстрактный', type: 'boolean', default: false },
  ]),
  node('interface', 'Интерфейс', { shape: 'rectangle', width: 220, height: 120 }, [
    { key: 'operations', label: 'Операции', type: 'string', default: '', visible: true },
  ]),
  node('enumeration', 'Перечисление', { shape: 'rectangle', width: 200, height: 120 }, [
    { key: 'values', label: 'Значения', type: 'string', default: '', visible: true },
  ]),
  node('actor', 'Актор', { shape: 'ellipse', width: 100, height: 100 }),
  node('useCase', 'Вариант использования', { shape: 'ellipse', width: 200, height: 90 }),
  node('component', 'Компонент', { shape: 'rectangle', width: 200, height: 100 }),
  node('package', 'Пакет', { shape: 'rectangle', width: 260, height: 160 }),
  node('node', 'Узел развёртывания', { shape: 'rectangle', width: 220, height: 140 }),
  node('note', 'Примечание', {
    shape: 'rectangle',
    width: 200,
    height: 100,
    fill: '#fffbeb',
    stroke: '#d97706',
  }),
];
const uml = notationSchema.parse({
  schemaVersion: 1,
  id: 'uml',
  version: '1.0.0',
  name: 'UML',
  description:
    'Классы, интерфейсы, варианты использования, компоненты и узлы. Ассоциации, наследование, реализация, агрегация и композиция.',
  nodeTypes: umlNodes,
  edgeTypes: [
    edge('association', 'Ассоциация', 'solid', 'none'),
    edge('dependency', 'Зависимость', 'dashed', 'thin-arrow'),
    edge('generalization', 'Обобщение / наследование', 'solid', 'hollow-triangle'),
    edge('realization', 'Реализация', 'dashed', 'hollow-triangle'),
    edge('aggregation', 'Агрегация', 'solid', 'none', 'hollow-diamond'),
    edge('composition', 'Композиция', 'solid', 'none', 'diamond'),
  ],
  connectionRules: [
    ...rules(umlNodes, 'association'),
    ...rules(umlNodes, 'dependency'),
    ...['class', 'interface', 'actor'].flatMap((id) =>
      rules(umlNodes, 'generalization', [id], [id]),
    ),
    ...rules(umlNodes, 'realization', ['class', 'component'], ['interface']),
    ...rules(umlNodes, 'aggregation', ['class'], ['class']),
    ...rules(umlNodes, 'composition', ['class'], ['class']),
  ],
});
// Shared read-only templates. Each diagram keeps its own frozen notation snapshot.
export const standardNotations = {
  builtin: builtinNotation,
  'builtin-bpmn': bpmn,
  'builtin-uml': uml,
};
export function standardNotation(id: string) {
  return Object.hasOwn(standardNotations, id)
    ? standardNotations[id as keyof typeof standardNotations]
    : undefined;
}
