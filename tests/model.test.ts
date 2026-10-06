import { describe, it, expect } from 'vitest';
import { builtinNotation } from '../src/lib/notation';
import {
  modelDiagramSchema,
  connectionTypeForSource,
  mergeModelObjects,
  modelErrors,
  projectDocument,
  packDocument,
  effectiveNode,
  effectiveEdge,
  hierarchyError,
  objectClosure,
  type ModelDocument,
  type ModelObject,
} from '../src/lib/model';
const object: ModelObject = {
  id: 'object',
  parentId: null,
  name: 'Заказ',
  description: '',
  attributes: { automated: true },
  archived: false,
  revision: 1,
};
function document(): ModelDocument {
  return {
    schemaVersion: 2,
    modelSpaceId: 'space',
    bindings: [
      { id: 'a', versionId: null, document: structuredClone(builtinNotation) },
      { id: 'b', versionId: null, document: structuredClone(builtinNotation) },
    ],
    objects: [structuredClone(object)],
    nodes: [
      {
        id: 'n1',
        objectId: 'object',
        bindingId: 'a',
        typeId: 'process',
        position: { x: 0, y: 0 },
        properties: {},
      },
      {
        id: 'n2',
        objectId: 'object',
        bindingId: 'b',
        typeId: 'process',
        position: { x: 300, y: 0 },
        properties: {},
      },
    ],
    edges: [],
  };
}
describe('cross-notation model', () => {
  it('supports multiple representations and qualifies matching type ids', () => {
    const d = document();
    expect(modelDiagramSchema.safeParse(d).success).toBe(true);
    expect(modelErrors(d)).toEqual([]);
    const view = projectDocument(d);
    expect(view.nodes.map((n) => n.typeId)).toEqual(['a:process', 'b:process']);
    expect(packDocument(view, d.objects)).toEqual(d);
    expect('objects' in view).toBe(false);
  });
  it('chooses source-notation links while preserving explicit choices and annotations', () => {
    const d = document();
    const secondary = d.bindings[1].document;
    secondary.edgeTypes.push({ ...secondary.edgeTypes[0], id: 'dependency', name: 'Зависимость' });
    const view = projectDocument(d);
    expect(connectionTypeForSource(view, 'n2', 'a:flow', 'out')).toBe('b:flow');
    expect(connectionTypeForSource(view, 'n2', 'b:dependency', 'out')).toBe('b:dependency');
    expect(connectionTypeForSource(view, 'n1', 'b:dependency', 'out')).toBe('a:flow');
    expect(connectionTypeForSource(view, 'n2', 'universal:association', 'out')).toBe(
      'universal:association',
    );
    secondary.connectionRules.unshift({
      edgeType: 'dependency',
      source: { nodeType: 'decision', port: 'yes' },
      target: { nodeType: 'process', port: 'in' },
      allowSelfLoop: false,
    });
    d.nodes[1].typeId = 'decision';
    expect(connectionTypeForSource(projectDocument(d), 'n2', 'a:flow', 'yes')).toBe('b:dependency');
  });
  it('round-trips relation identities and validates object endpoints independently of skins', () => {
    const d = document();
    d.nodes[1].bindingId = 'a';
    d.relations = [
      {
        id: 'relation',
        sourceId: 'object',
        targetId: 'object',
        name: 'Связь',
        description: '',
        attributes: {},
        revision: 1,
        archived: false,
      },
    ];
    d.edges = [
      {
        id: 'e',
        relationId: 'relation',
        bindingId: 'a',
        typeId: 'flow',
        source: 'n1',
        target: 'n2',
        sourcePort: 'out',
        targetPort: 'in',
        properties: { label: 'Локальная подпись' },
      },
    ];
    expect(modelErrors(d)).toEqual([]);
    expect(packDocument(projectDocument(d), d.objects)).toEqual(d);
    d.relations[0].sourceId = 'missing';
    expect(modelErrors(d)).toContain('Участники стрелки не соответствуют связи модели');
    d.relations = [];
    expect(modelErrors(d)).toContain('Стрелка ссылается на отсутствующую связь модели');
  });
  it('binds common relation attributes while preserving local arrow captions', () => {
    const t = structuredClone(builtinNotation.edgeTypes[0]);
    t.properties.push({
      key: 'role',
      objectKey: 'responsibility',
      label: 'Роль',
      type: 'string',
      required: false,
      scope: 'object',
    });
    const e = {
      id: 'e',
      typeId: 'flow',
      source: 'a',
      target: 'b',
      sourcePort: 'out',
      targetPort: 'in',
      properties: { label: 'Подпись', role: 'Устаревшее' },
    };
    const r = {
      id: 'r',
      sourceId: 'object',
      targetId: 'object',
      name: 'Общая связь',
      description: '',
      attributes: { responsibility: 'Владелец' },
      archived: false,
      revision: 1,
    };
    expect(effectiveEdge(e, t, r).properties).toEqual({ label: 'Подпись', role: 'Владелец' });
    expect(e.properties.role).toBe('Устаревшее');
    const copy = {
      ...object,
      id: 'copy',
      copiedFrom: { id: 'deleted-origin', name: 'Удалённый оригинал' },
    };
    expect(
      modelDiagramSchema.parse({ ...document(), objects: [object, copy] }).objects[1].copiedFrom,
    ).toEqual(copy.copiedFrom);
  });
  it('inherits shared name and bound values without mutating local data', () => {
    const d = document(),
      t = d.bindings[0].document.nodeTypes.find((t) => t.id === 'process')!;
    t.properties.push({
      key: 'auto',
      objectKey: 'automated',
      scope: 'object',
      label: 'Авто',
      type: 'boolean',
      required: true,
    });
    const n = d.nodes[0];
    n.label = 'Локальная подпись';
    n.properties.auto = false;
    const effective = effectiveNode(n, t, object);
    expect(effective.properties).toMatchObject({ title: 'Заказ', auto: true });
    expect(effective.label).toBe('Локальная подпись');
    expect(n.properties).toEqual({ auto: false });
    expect(modelErrors(d)).toEqual([]);
  });
  it('rejects typed connections between unrelated bindings, permits graphical annotations', () => {
    const d = document();
    d.edges = [
      {
        id: 'e',
        bindingId: 'a',
        typeId: 'flow',
        source: 'n1',
        target: 'n2',
        sourcePort: 'out',
        targetPort: 'in',
        properties: { label: '' },
      },
    ];
    expect(modelErrors(d)).toContain('Соединение запрещено правилами нотации');
    d.edges[0].bindingId = null;
    d.edges[0].typeId = 'association';
    expect(modelErrors(d)).toEqual([]);
    d.edges[0].sourcePort = 'in';
    expect(modelErrors(d)).toContain('Неизвестный порт поясняющей связи');
  });
  it('validates annotation appearance, properties and connection capacities', () => {
    const d = document();
    d.bindings[0].document.nodeTypes
      .find((t) => t.id === 'process')!
      .ports.find((p) => p.id === 'out')!.maxConnections = 1;
    d.edges = [
      {
        id: 'e',
        bindingId: null,
        typeId: 'association',
        source: 'n1',
        target: 'n2',
        sourcePort: 'out',
        targetPort: 'in',
        properties: { label: 'A' },
        appearance: { line: 'custom' },
      },
      {
        id: 'e2',
        bindingId: null,
        typeId: 'association',
        source: 'n1',
        target: 'n2',
        sourcePort: 'out',
        targetPort: 'in',
        properties: { label: 1 },
      },
    ];
    expect(modelErrors(d)).toContain('Для пользовательской линии задайте dashPattern');
    expect(modelErrors(d)).toContain('Неверные свойства поясняющей связи');
    expect(modelErrors(d)).toContain('Превышено число связей порта out');
  });
  it('detects dangling references, unknown profiles and duplicate binding ids', () => {
    const d = document();
    d.nodes[0].objectId = 'missing';
    d.nodes[1].profiles = { 'absent:process': { title: 'Other' } };
    d.bindings[1].id = 'a';
    expect(modelErrors(d)).toEqual(
      expect.arrayContaining([
        'Представление ссылается на отсутствующий объект',
        'Неизвестный профиль отображения',
        'Повторяющиеся подключения нотаций',
      ]),
    );
  });
  it('exports ancestor closure once, preserving hierarchy without adding representations', () => {
    const d = document();
    const parent = { ...object, id: 'parent' };
    d.objects[0].parentId = parent.id;
    d.objects.push(parent, { ...object, id: 'unrelated' });
    expect(objectClosure(['object', 'object'], d.objects).map((o) => o.id)).toEqual([
      'object',
      'parent',
    ]);
    expect(packDocument(projectDocument(d), d.objects).nodes).toHaveLength(2);
    expect(packDocument(projectDocument(d), d.objects).objects).toHaveLength(2);
  });
  it('rejects tree cycles, missing parents and duplicate object identities', () => {
    expect(
      hierarchyError([
        { id: 'a', parentId: 'b' },
        { id: 'b', parentId: 'a' },
      ]),
    ).toMatch(/цикл/);
    expect(hierarchyError([{ id: 'a', parentId: 'a' }])).toMatch(/цикл/);
    expect(hierarchyError([{ id: 'a', parentId: 'missing' }])).toMatch(/не найден/);
    expect(
      hierarchyError([
        { id: 'a', parentId: null },
        { id: 'a', parentId: null },
      ]),
    ).toMatch(/Повторяющиеся/);
  });
  it('roundtrips local skin profiles, shapes and captions', () => {
    const d = document();
    d.nodes[0].profiles = { 'a:event': { title: 'Ранее' } };
    d.nodes[0].label = 'Местная';
    d.nodes[0].appearance = { fontSize: 22 };
    const packed = packDocument(projectDocument(d), d.objects);
    expect(packed).toEqual(d);
    expect(modelErrors(packed)).toEqual([]);
  });
  it('inherits names for notation types without a title property and keeps numeric titles typed', () => {
    const d = document(),
      t = d.bindings[0].document.nodeTypes.find((t) => t.id === 'process')!;
    t.properties = [];
    expect(effectiveNode(d.nodes[0], t, object).label).toBe('Заказ');
    expect(modelErrors(d)).toEqual([]);
    t.properties = [{ key: 'title', label: 'Номер', type: 'number', required: true }];
    d.nodes[0].properties.title = 42;
    expect(effectiveNode(d.nodes[0], t, object).properties.title).toBe(42);
    expect(modelErrors(d)).toEqual([]);
  });
  it('rejects reserved bindings and duplicate graphical edge identities', () => {
    const d = document();
    d.bindings[0].id = 'universal';
    expect(modelDiagramSchema.safeParse(d).success).toBe(false);
    const good = document();
    const edge = {
      id: 'duplicate',
      bindingId: null,
      typeId: 'association',
      source: 'n1',
      target: 'n2',
      sourcePort: 'out',
      targetPort: 'in',
      properties: {},
    };
    good.edges = [edge, edge];
    expect(modelErrors(good)).toContain('Повторяющиеся идентификаторы связей');
  });
  it('keeps the newest shared revision, stable references and tree order on delayed responses', () => {
    const latest = { ...object, revision: 2, name: 'Новое имя' },
      other = { ...object, id: 'other' };
    const before = [latest, other];
    const stale = mergeModelObjects(before, [object]);
    expect(stale).toEqual(before);
    expect(stale[0]).toBe(latest);
    const changed = { ...latest, revision: 3, name: 'Ещё новее' };
    expect(mergeModelObjects(before, [changed]).map((o) => o.id)).toEqual(['object', 'other']);
    expect(mergeModelObjects(before, [changed])[0]).toBe(changed);
    expect(mergeModelObjects(before, [object], true)).toEqual([latest]);
  });
  it('accepts a restored incarnation with a restarted revision counter', () => {
    const old = { ...object, revision: 9, incarnation: '2026-10-06T10:00:00.000Z' },
      restored = {
        ...object,
        revision: 1,
        incarnation: '2026-10-06T11:00:00.000Z',
        name: 'Восстановлен',
      };
    expect(mergeModelObjects([old], [restored])[0]).toBe(restored);
  });
});
