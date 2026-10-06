'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Upload,
  Download,
  Copy,
  Pencil,
  Trash2,
  Shapes,
  Check,
  Code2,
  SlidersHorizontal,
} from 'lucide-react';
import { api, download, readJson } from '@/lib/client';
import { builtinNotation, notationSchema, NotationDocument } from '@/lib/notation';
import { NotationItem } from './library';
import { Modal } from './modal';
import { ShapeDesigner } from './shape-designer';
import { NodeShape } from './node-shape';
import { NumberField, TextAppearanceControls, EdgeAppearanceControls } from './appearance-controls';
import {
  shapePoints,
  type CustomShape,
  type NodeOverride,
  type EdgeOverride,
} from '@/lib/appearance';
const copy = (n: NotationDocument) => ({
  ...structuredClone(n),
  id: `notation-${crypto.randomUUID()}`,
  name: `${n.name} — копия`,
  version: '1.0.0',
});
export function NotationsPage() {
  const [items, setItems] = useState<NotationItem[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [editing, setEditing] = useState<{ id?: string; document: NotationDocument } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  async function load() {
    try {
      setItems(await api<NotationItem[]>('notations'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">МОДЕЛИРУЙТЕ ПО-СВОЕМУ</div>
          <h1>
            Нотации <span className="count">{items.length}</span>
          </h1>
          <p className="muted">Элементы, свойства и правила — язык ваших диаграмм.</p>
        </div>
        <div className="button-row">
          <input
            type="file"
            hidden
            ref={file}
            accept=".json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const document = notationSchema.parse(await readJson(f));
                setEditing({ document });
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
          <button className="secondary" onClick={() => file.current?.click()}>
            <Upload size={17} />
            Импорт
          </button>
          <button
            className="primary"
            onClick={() =>
              setEditing({
                document: { ...copy(builtinNotation), name: 'Новая нотация', description: '' },
              })
            }
          >
            <Plus size={18} />
            Создать нотацию
          </button>
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="info-banner">
        <Shapes size={23} />
        <div>
          <strong>Нотация определяет язык диаграммы</strong>
          <p>
            Настройте внешний вид элементов и допустимые связи. Каждая диаграмма сохраняет свою
            версию нотации.
          </p>
        </div>
      </div>
      {loading ? (
        <div className="empty">Загружаем нотации…</div>
      ) : (
        <div className="notation-grid">
          {items.map((n) => (
            <article className="notation-card" key={n.id}>
              <div className="notation-card-top">
                <span className="file-icon large">
                  <Shapes size={25} />
                </span>
                <span className={`badge ${n.builtin ? 'green' : ''}`}>
                  {n.builtin ? 'Готовая' : 'Пользовательская'}
                </span>
              </div>
              <h2>{n.name}</h2>
              <p className="muted">
                {n.document.description || 'Ваша собственная система элементов и связей.'}
              </p>
              <div className="notation-samples">
                {n.document.nodeTypes.slice(0, 4).map((t) => (
                  <div key={t.id} title={t.name} className="notation-sample-render">
                    <NodeShape
                      appearance={{ ...t.appearance, width: 65, height: 38, strokeWidth: 1 }}
                      shapes={n.document.shapes}
                      className="shape-library-preview"
                    />
                    <span>{t.name}</span>
                  </div>
                ))}
              </div>
              <div className="notation-stats">
                <span>{n.document.nodeTypes.length} типов элементов</span>
                <span>{n.document.edgeTypes.length} типов связей</span>
                <span>v{n.document.version}</span>
              </div>
              <div className="notation-actions">
                <button
                  className="secondary"
                  onClick={() => {
                    const doc = structuredClone(n.document);
                    if (!n.builtin) {
                      const parts = doc.version.split('.').map(Number);
                      parts[2]++;
                      doc.version = parts.join('.');
                    }
                    setEditing({
                      id: n.builtin ? undefined : n.id,
                      document: n.builtin ? copy(doc) : doc,
                    });
                  }}
                >
                  {n.builtin ? <Copy size={15} /> : <Pencil size={15} />}{' '}
                  {n.builtin ? 'Создать копию' : 'Редактировать'}
                </button>
                <button
                  className="icon-button"
                  title="Экспорт"
                  aria-label={`Экспорт ${n.name}`}
                  onClick={() => download(`${n.document.id}.notation.json`, n.document)}
                >
                  <Download size={17} />
                </button>
                {!n.builtin && (
                  <>
                    <button
                      className="icon-button"
                      title="Копировать"
                      aria-label={`Копировать ${n.name}`}
                      onClick={() => setEditing({ document: copy(n.document) })}
                    >
                      <Copy size={17} />
                    </button>
                    <button
                      className="icon-button danger"
                      title="Удалить"
                      aria-label={`Удалить ${n.name}`}
                      onClick={async () => {
                        if (!confirm('Удалить нотацию? Используемые нотации удалить нельзя.'))
                          return;
                        try {
                          await api(`notations/${n.id}`, 'DELETE');
                          await load();
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      <Trash2 size={17} />
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {editing && (
        <Modal
          title={editing.id ? 'Новая версия нотации' : 'Создать нотацию'}
          onClose={() => setEditing(null)}
          className="notation-modal"
        >
          <NotationEditor
            initial={editing.document}
            lockedId={!!editing.id}
            onSave={async (document) => {
              await api(
                `notations${editing.id ? `/${editing.id}` : ''}`,
                editing.id ? 'PUT' : 'POST',
                document,
              );
              setEditing(null);
              await load();
            }}
          />
        </Modal>
      )}
    </main>
  );
}
function NotationEditor({
  initial,
  lockedId,
  onSave,
}: {
  initial: NotationDocument;
  lockedId: boolean;
  onSave: (n: NotationDocument) => Promise<void>;
}) {
  const [document, setDocument] = useState(initial),
    [text, setText] = useState(JSON.stringify(initial, null, 2)),
    [tab, setTab] = useState('visual'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [designer, setDesigner] = useState<{ nodeId?: string; shape: CustomShape } | null>(null);
  const update = (n: NotationDocument) => {
    setDocument(n);
    setText(JSON.stringify(n, null, 2));
  };
  function switchTab(next: string) {
    try {
      if (tab === 'json') update(notationSchema.parse(JSON.parse(text)));
      setError('');
      setTab(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <form
      className="form-stack notation-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          const n = notationSchema.parse(tab === 'json' ? JSON.parse(text) : document);
          await onSave(n);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="tabs">
        <button
          type="button"
          className={tab === 'visual' ? 'selected' : ''}
          onClick={() => switchTab('visual')}
        >
          <SlidersHorizontal size={16} />
          Конструктор
        </button>
        <button
          type="button"
          className={tab === 'json' ? 'selected' : ''}
          onClick={() => switchTab('json')}
        >
          <Code2 size={16} />
          JSON
        </button>
      </div>
      {tab === 'json' ? (
        <>
          <p className="muted">
            Полная схема поддерживает свойства, порты, лимиты связей и правила соединения.
          </p>
          <textarea
            className="code-editor"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            aria-label="JSON нотации"
          />
        </>
      ) : (
        <>
          <div className="form-grid">
            <label>
              Название
              <input
                value={document.name}
                onChange={(e) => update({ ...document, name: e.target.value })}
                required
                maxLength={100}
              />
            </label>
            <label>
              Версия
              <input
                value={document.version}
                onChange={(e) => update({ ...document, version: e.target.value })}
                required
                pattern="[0-9]+\.[0-9]+\.[0-9]+"
              />
            </label>
            <label>
              Идентификатор
              <input
                value={document.id}
                disabled={lockedId}
                onChange={(e) => update({ ...document, id: e.target.value })}
                required
                pattern="[a-zA-Z0-9_-]+"
              />
            </label>
          </div>
          <label>
            Описание
            <textarea
              value={document.description}
              onChange={(e) => update({ ...document, description: e.target.value })}
              maxLength={2000}
              rows={2}
            />
          </label>
          <div className="section-title">
            <h3>Пользовательские формы</h3>
            <button
              type="button"
              className="secondary small"
              onClick={() =>
                setDesigner({
                  shape: {
                    id: `shape-${crypto.randomUUID().slice(0, 8)}`,
                    name: 'Новая форма',
                    baseShape: 'rectangle',
                    points: shapePoints('rectangle'),
                    rounding: 0,
                  },
                })
              }
            >
              Создать форму
            </button>
          </div>
          <div className="custom-shape-library">
            {document.shapes?.map((shape) => (
              <div className="custom-shape-item" key={shape.id}>
                <NodeShape
                  appearance={{
                    shape: 'custom',
                    shapeId: shape.id,
                    width: 60,
                    height: 40,
                    fill: '#eef2ff',
                    stroke: '#6366f1',
                  }}
                  shapes={document.shapes}
                  className="shape-library-preview"
                />
                <strong>{shape.name}</strong>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => setDesigner({ shape: structuredClone(shape) })}
                >
                  Изменить форму
                </button>
                <button
                  type="button"
                  className="icon-button danger"
                  aria-label={`Удалить форму ${shape.name}`}
                  disabled={document.nodeTypes.some(
                    (n) => n.appearance.shape === 'custom' && n.appearance.shapeId === shape.id,
                  )}
                  onClick={() =>
                    update({
                      ...document,
                      shapes: document.shapes?.filter((s) => s.id !== shape.id),
                    })
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          {designer && (
            <ShapeDesigner
              key={designer.shape.id}
              initial={designer.shape}
              onCancel={() => setDesigner(null)}
              onSave={(shape) => {
                const exists = document.shapes?.some((s) => s.id === shape.id);
                update({
                  ...document,
                  shapes: exists
                    ? document.shapes!.map((s) => (s.id === shape.id ? shape : s))
                    : [...(document.shapes ?? []), shape],
                  nodeTypes: document.nodeTypes.map((n) =>
                    n.id === designer.nodeId
                      ? {
                          ...n,
                          appearance: { ...n.appearance, shape: 'custom', shapeId: shape.id },
                        }
                      : n,
                  ),
                });
                setDesigner(null);
              }}
            />
          )}
          <div className="section-title">
            <h3>Элементы</h3>
            <button
              type="button"
              className="secondary small"
              onClick={() => {
                const id = `node-${crypto.randomUUID().slice(0, 8)}`;
                update({
                  ...document,
                  nodeTypes: [
                    ...document.nodeTypes,
                    {
                      id,
                      name: 'Новый элемент',
                      appearance: {
                        shape: 'rounded',
                        width: 180,
                        height: 80,
                        fill: '#eef2ff',
                        stroke: '#6366f1',
                      },
                      properties: [
                        {
                          key: 'title',
                          label: 'Название',
                          type: 'string',
                          required: true,
                          default: 'Элемент',
                        },
                      ],
                      ports: [
                        { id: 'in', direction: 'input' },
                        { id: 'out', direction: 'output' },
                      ],
                    },
                  ],
                });
              }}
            >
              <Plus size={14} />
              Добавить
            </button>
          </div>
          {document.nodeTypes.map((node, index) => {
            const change = (value: Partial<typeof node>) =>
              update({
                ...document,
                nodeTypes: document.nodeTypes.map((n, i) => (i === index ? { ...n, ...value } : n)),
              });
            return (
              <fieldset key={node.id} className="node-config">
                <legend>{node.id}</legend>
                <div className="form-grid">
                  <label>
                    Название
                    <input
                      value={node.name}
                      onChange={(e) => change({ name: e.target.value })}
                      required
                      maxLength={100}
                    />
                  </label>
                  <label>
                    Форма
                    <select
                      aria-label={`Форма ${node.name}`}
                      value={
                        node.appearance.shape === 'custom'
                          ? `custom:${node.appearance.shapeId}`
                          : node.appearance.shape
                      }
                      onChange={(e) =>
                        change({
                          appearance: {
                            ...node.appearance,
                            shape: e.target.value.startsWith('custom:')
                              ? 'custom'
                              : (e.target.value as typeof node.appearance.shape),
                            shapeId: e.target.value.startsWith('custom:')
                              ? e.target.value.slice(7)
                              : undefined,
                          },
                        })
                      }
                    >
                      {[
                        ['rectangle', 'Прямоугольник'],
                        ['rounded', 'Скруглённый'],
                        ['diamond', 'Ромб'],
                        ['ellipse', 'Эллипс'],
                        ['text', 'Текст'],
                      ].map(([v, t]) => (
                        <option key={v} value={v}>
                          {t}
                        </option>
                      ))}
                      {document.shapes?.map((shape) => (
                        <option key={shape.id} value={`custom:${shape.id}`}>
                          {shape.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="button-row">
                  <label>
                    Заливка
                    <input
                      type="color"
                      value={node.appearance.fill}
                      onChange={(e) =>
                        change({ appearance: { ...node.appearance, fill: e.target.value } })
                      }
                    />
                  </label>
                  <label>
                    Контур
                    <input
                      type="color"
                      value={node.appearance.stroke}
                      onChange={(e) =>
                        change({ appearance: { ...node.appearance, stroke: e.target.value } })
                      }
                    />
                  </label>
                  <label>
                    Ширина
                    <input
                      type="number"
                      min={40}
                      max={600}
                      value={node.appearance.width}
                      onChange={(e) =>
                        change({
                          appearance: { ...node.appearance, width: Number(e.target.value) },
                        })
                      }
                    />
                  </label>
                  <label>
                    Высота
                    <input
                      type="number"
                      min={30}
                      max={400}
                      value={node.appearance.height}
                      onChange={(e) =>
                        change({
                          appearance: { ...node.appearance, height: Number(e.target.value) },
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-button danger"
                    title="Удалить тип"
                    onClick={() =>
                      update({
                        ...document,
                        nodeTypes: document.nodeTypes.filter((_, i) => i !== index),
                        connectionRules: document.connectionRules.filter(
                          (r) => r.source.nodeType !== node.id && r.target.nodeType !== node.id,
                        ),
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => {
                    const original = document.shapes?.find((s) => s.id === node.appearance.shapeId);
                    const base =
                      node.appearance.shape === 'text' || node.appearance.shape === 'custom'
                        ? 'rectangle'
                        : node.appearance.shape;
                    setDesigner({
                      nodeId: node.id,
                      shape: {
                        ...(original ?? {
                          baseShape: base,
                          points: shapePoints(base),
                          rounding: base === 'rounded' ? 15 : base === 'ellipse' ? 45 : 0,
                        }),
                        id: `shape-${crypto.randomUUID().slice(0, 8)}`,
                        name: `Форма: ${node.name}`,
                      },
                    });
                  }}
                >
                  Модифицировать базовую форму
                </button>
                <div className="node-type-preview">
                  <NodeShape
                    appearance={{ ...node.appearance, width: 180, height: 100 }}
                    shapes={document.shapes}
                    className="shape-library-preview"
                  />
                  <span
                    style={{
                      fontSize: node.appearance.fontSize ?? 12,
                      transform: `rotate(${node.appearance.textRotation ?? 0}deg)`,
                    }}
                  >
                    {String(node.properties.find((p) => p.key === 'title')?.default ?? node.name)}
                  </span>
                </div>
                <TextAppearanceControls
                  value={node.appearance}
                  onChange={(patch: NodeOverride) =>
                    change({ appearance: { ...node.appearance, ...patch } })
                  }
                />
                <details>
                  <summary>Отображение атрибутов</summary>
                  <div className="attribute-visibility">
                    {node.properties
                      .filter((p) => p.key !== 'title')
                      .map((p) => (
                        <label key={p.key} className="inline-check">
                          <input
                            type="checkbox"
                            checked={p.visible !== false}
                            onChange={(e) =>
                              change({
                                properties: node.properties.map((item) =>
                                  item.key === p.key
                                    ? { ...item, visible: e.target.checked }
                                    : item,
                                ),
                              })
                            }
                          />
                          {p.label}
                        </label>
                      ))}
                  </div>
                </details>
                <details>
                  <summary>
                    Свойства и порты ({node.properties.length} / {node.ports.length})
                  </summary>
                  <p className="muted">
                    Для точной настройки типов свойств и портов используйте вкладку JSON.
                  </p>
                  <pre className="compact-code">
                    {JSON.stringify({ properties: node.properties, ports: node.ports }, null, 2)}
                  </pre>
                </details>
              </fieldset>
            );
          })}
          <div className="section-title">
            <h3>Связи и правила</h3>
          </div>
          {document.edgeTypes.map((edge, index) => (
            <fieldset className="node-config" key={edge.id}>
              <legend>{edge.name}</legend>
              <EdgeAppearanceControls
                value={edge.appearance}
                onChange={(patch: EdgeOverride) =>
                  update({
                    ...document,
                    edgeTypes: document.edgeTypes.map((e, i) =>
                      i === index ? { ...e, appearance: { ...e.appearance, ...patch } } : e,
                    ),
                  })
                }
              />
            </fieldset>
          ))}
          <p className="muted">
            {document.edgeTypes.map((e) => e.name).join(', ')} · {document.connectionRules.length}{' '}
            правил. Новые элементы не соединяются, пока вы не добавите правила.
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              update({
                ...document,
                connectionRules: document.edgeTypes.flatMap((edge) =>
                  document.nodeTypes.flatMap((source) =>
                    source.ports
                      .filter((p) => p.direction === 'output')
                      .flatMap((out) =>
                        document.nodeTypes.flatMap((target) =>
                          target.ports
                            .filter((p) => p.direction === 'input')
                            .map((input) => ({
                              edgeType: edge.id,
                              source: { nodeType: source.id, port: out.id },
                              target: { nodeType: target.id, port: input.id },
                              allowSelfLoop: false,
                            })),
                        ),
                      ),
                  ),
                ),
              });
            }}
          >
            Разрешить связи между всеми типами
          </button>
          <details>
            <summary>Посмотреть правила соединений</summary>
            <pre className="compact-code">{JSON.stringify(document.connectionRules, null, 2)}</pre>
          </details>
        </>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="modal-footer">
        <span className="muted">Сохранение создаёт неизменяемую версию.</span>
        <button className="primary" disabled={busy}>
          <Check size={17} />
          {busy ? 'Сохраняем…' : 'Сохранить нотацию'}
        </button>
      </div>
    </form>
  );
}
