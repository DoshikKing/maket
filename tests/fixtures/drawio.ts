import { builtinNotation } from '../../src/lib/notation';
import { modelDiagramSchema, objectSnapshotSchema, type ModelObject } from '../../src/lib/model';
export function drawioFixture() {
  const notation = structuredClone(builtinNotation);
  notation.shapes = [
    {
      id: 'custom',
      name: 'Скруглённый контур',
      baseShape: 'rectangle',
      rounding: 10,
      points: [
        { x: 0, y: 0 },
        { x: 80, y: 0 },
        { x: 100, y: 70 },
        { x: 50, y: 100 },
        { x: 0, y: 70 },
      ],
    },
  ];
  notation.nodeTypes.find((t) => t.id === 'process')!.appearance = {
    shape: 'custom',
    shapeId: 'custom',
    width: 180,
    height: 80,
    fill: '#eef2ff',
    stroke: '#6366f1',
  };
  const object = (id: string, name: string, attributes: ModelObject['attributes']) =>
    objectSnapshotSchema.parse({
      id,
      name,
      attributes,
      parentId: null,
      description: 'Описание <&> "пример"\nСтрока 2 😀',
      archived: false,
      revision: 3,
    });
  const objects = [
    object('original', 'Общий объект', {
      enabled: false,
      count: 0,
      note: 'Текст <&> "данные"\n😀',
    }),
    object('instance', 'Реализация', { own: 'value' }),
    object('unrelated', 'НЕ ЭКСПОРТИРОВАТЬ', {}),
  ];
  const relation = (
    id: string,
    sourceId: string,
    targetId: string,
    relationType = 'Ассоциация',
  ) => ({
    id,
    sourceId,
    targetId,
    relationType,
    parentId: null,
    name: id,
    description: 'Описание связи',
    archived: false,
    revision: 2,
    attributes: { approved: true },
  });
  const document = modelDiagramSchema.parse({
    schemaVersion: 2,
    modelSpaceId: 'test',
    bindings: [{ id: 'binding', versionId: null, document: notation }],
    objects,
    relations: [
      relation('loop', 'original', 'original'),
      relation('detached', 'instance', 'original'),
      relation('edge_link', 'loop', 'instance'),
      relation('derivation', 'original', 'instance', 'экземпляр'),
    ],
    nodes: [
      {
        id: 'first',
        bindingId: 'binding',
        typeId: 'process',
        objectId: 'original',
        position: { x: -50, y: -30 },
        size: { width: 240, height: 100 },
        layer: 5,
        properties: {},
        attributes: { local: 'first' },
        appearance: { fontSize: 18, textRotation: 35, textAlign: 'left' },
      },
      {
        id: 'alias',
        bindingId: 'binding',
        typeId: 'process',
        objectId: 'original',
        position: { x: 350, y: 80 },
        layer: -1,
        properties: {},
        label: '<img src=x onerror=alert(1)> & "Алиас"\nВторая строка',
        attributes: { local: 'alias' },
      },
      {
        id: 'child',
        bindingId: 'binding',
        typeId: 'event',
        objectId: 'instance',
        position: { x: 650, y: 200 },
        properties: {},
        attributes: {},
      },
    ],
    edges: [
      {
        id: 'between_aliases',
        bindingId: 'binding',
        typeId: 'flow',
        relationId: 'loop',
        source: 'first',
        target: 'alias',
        sourcePort: 'out',
        targetPort: 'in',
        properties: { label: 'Поток <&>' },
        appearance: {
          line: 'dashed',
          width: 4,
          targetMarker: 'hollow-triangle',
          sourceMarker: 'circle',
          routing: 'bezier',
        },
      },
      {
        id: 'free',
        bindingId: 'binding',
        typeId: 'flow',
        relationId: 'detached',
        source: 'child',
        target: 'alias',
        sourcePort: 'out',
        targetPort: 'in',
        detachedTarget: { x: 980, y: 400 },
        properties: {},
      },
      {
        id: 'from_edge',
        bindingId: null,
        typeId: 'association',
        relationId: 'edge_link',
        source: 'between_aliases',
        target: 'child',
        sourcePort: 'out',
        targetPort: 'in',
        properties: {},
      },
      {
        id: 'instance_edge',
        bindingId: null,
        typeId: 'association',
        relationId: 'derivation',
        source: 'first',
        target: 'child',
        sourcePort: 'out',
        targetPort: 'in',
        properties: {},
      },
    ],
  });
  return { name: 'Тест <&> "draw.io" 😀', document, objects };
}
