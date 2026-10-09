'use client';
import { useEffect, useId, useState } from 'react';
import {
  FolderPlus,
  Plus,
  Pencil,
  Trash2,
  Archive,
  Copy,
  LocateFixed,
  GitBranch,
  ChevronRight,
} from 'lucide-react';
import { api, date } from '@/lib/client';
import {
  attributesSchema,
  type ModelObject,
  type ModelRelation,
  type ViewDocument,
} from '@/lib/model';
import { defaults } from '@/lib/notation';
import { Modal } from './modal';
import { CopyOrigin } from './copy-origin';
export function RelationEditor({
  relation,
  parentId,
  sourceId,
  objects,
  onSaved,
  onClose,
  children,
}: {
  relation?: ModelRelation;
  parentId?: string | null;
  sourceId?: string;
  objects: ModelObject[];
  onSaved: (r: ModelRelation) => void;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const [name, setName] = useState(relation?.name ?? 'Новая связь'),
    [description, setDescription] = useState(relation?.description ?? ''),
    [source, setSource] = useState(relation?.sourceId ?? sourceId ?? ''),
    [relationType, setRelationType] = useState(relation?.relationType ?? 'Привязка'),
    [types, setTypes] = useState<string[]>([]),
    [target, setTarget] = useState(relation?.targetId ?? ''),
    [parent, setParent] = useState(relation?.parentId ?? parentId ?? ''),
    [attributes, setAttributes] = useState(
      Object.entries(relation?.attributes ?? {}).map(([key, value]) => ({ key, value })),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [history, setHistory] = useState<
      { number: number; createdAt: string; snapshot: ModelRelation }[] | null
    >(null),
    [usages, setUsages] = useState<
      { count: number; diagram: { id: string; name: string } }[] | null
    >(null);
  const guard = { revision: relation?.revision, incarnation: relation?.incarnation };
  const typeListId = useId();
  useEffect(() => {
    void api<{ relations: ModelRelation[] }>('model')
      .then((s) =>
        setTypes([
          ...new Set(s.relations.map((r) => r.relationType).filter((t): t is string => !!t)),
        ]),
      )
      .catch(() => {});
  }, []);
  return (
    <Modal
      title={relation ? 'Общие свойства связи' : 'Создать связь модели'}
      onClose={onClose}
      className="object-modal"
    >
      <p className="muted small-text">
        Связь соединяет объекты или другие связи модели. Стрелки на диаграммах — её представления;
        их подписи и оформление могут различаться.
      </p>
      <CopyOrigin origin={relation?.copiedFrom} />
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            if (new Set(attributes.map((a) => a.key)).size !== attributes.length)
              throw new Error('Ключи атрибутов должны быть уникальны');
            const values = attributesSchema.parse(
              Object.fromEntries(attributes.map((a) => [a.key, a.value])),
            );
            onSaved(
              await api<ModelRelation>(
                relation ? `relations/${relation.id}` : 'relations',
                relation ? 'PATCH' : 'POST',
                {
                  name,
                  description,
                  attributes: values,
                  parentId: parent || null,
                  relationType,
                  sourceId: source,
                  targetId: target,
                  ...(relation ? guard : {}),
                },
              ),
            );
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Контейнер в дереве
          <select
            aria-label="Родитель связи"
            value={parent}
            onChange={(e) => setParent(e.target.value)}
          >
            <option value="">Корень модели</option>
            {objects
              .filter((o) => o.id !== relation?.id && (!o.archived || o.id === parent))
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </select>
          <small className="muted">
            Только место хранения. Участники связи выбираются независимо от вложенности.
          </small>
        </label>
        <label>
          Тип связи
          <input
            aria-label="Тип связи"
            list={typeListId}
            maxLength={100}
            value={relationType}
            onChange={(e) => setRelationType(e.target.value)}
            placeholder="Привязка или новый тип"
          />
          <datalist id={typeListId}>
            {types.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <small className="muted">
            Выберите существующий тип или введите новый. Тип не зависит от нотации.
          </small>
        </label>
        <label>
          Имя связи
          <input
            aria-label="Имя связи"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Описание связи
          <textarea
            aria-label="Описание связи"
            maxLength={4000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {(
          [
            ['Источник связи', source, setSource],
            ['Назначение связи', target, setTarget],
          ] as const
        ).map(([label, value, setValue]) => (
          <label key={label}>
            {label}
            <select
              aria-label={label}
              value={value}
              required
              onChange={(e) => setValue(e.target.value)}
            >
              <option value="">Выберите объект</option>
              {objects
                .filter((o) => o.id !== relation?.id && (!o.archived || o.id === value))
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          </label>
        ))}
        {relation && (
          <small className="muted">
            Источник — исходящий участник, назначение — входящий. Участников можно менять, если у
            связи нет представлений на диаграммах.
          </small>
        )}
        <div className="section-title">
          <strong>Общие атрибуты</strong>
          <button
            type="button"
            className="secondary small"
            disabled={attributes.length >= 100}
            onClick={() => setAttributes([...attributes, { key: '', value: '' }])}
          >
            Добавить атрибут
          </button>
        </div>
        {attributes.map((a, i) => (
          <div className="object-attribute" key={i}>
            <input
              aria-label={`Ключ атрибута связи ${i + 1}`}
              placeholder="Ключ"
              value={a.key}
              onChange={(e) =>
                setAttributes(
                  attributes.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)),
                )
              }
            />
            <select
              aria-label={`Тип атрибута связи ${i + 1}`}
              value={typeof a.value}
              onChange={(e) =>
                setAttributes(
                  attributes.map((x, j) =>
                    j === i
                      ? {
                          ...x,
                          value:
                            e.target.value === 'boolean'
                              ? false
                              : e.target.value === 'number'
                                ? 0
                                : '',
                        }
                      : x,
                  ),
                )
              }
            >
              <option value="string">Текст</option>
              <option value="number">Число</option>
              <option value="boolean">Да / нет</option>
            </select>
            {typeof a.value === 'boolean' ? (
              <input
                aria-label={`Значение атрибута связи ${i + 1}`}
                type="checkbox"
                checked={a.value}
                onChange={(e) =>
                  setAttributes(
                    attributes.map((x, j) => (j === i ? { ...x, value: e.target.checked } : x)),
                  )
                }
              />
            ) : (
              <input
                aria-label={`Значение атрибута связи ${i + 1}`}
                type={typeof a.value === 'number' ? 'number' : 'text'}
                value={a.value}
                onChange={(e) =>
                  setAttributes(
                    attributes.map((x, j) =>
                      j === i
                        ? {
                            ...x,
                            value:
                              typeof x.value === 'number' ? Number(e.target.value) : e.target.value,
                          }
                        : x,
                    ),
                  )
                }
              />
            )}
            <button
              type="button"
              className="secondary small"
              aria-label={`Удалить атрибут связи ${i + 1}`}
              onClick={() => setAttributes(attributes.filter((_, j) => j !== i))}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? 'Сохраняем…' : 'Сохранить связь'}
        </button>
      </form>
      {children}
      {relation && (
        <div className="form-stack relation-history">
          <button
            className="secondary small"
            disabled={busy}
            onClick={async () => {
              try {
                setUsages(await api(`relations/${relation.id}/usages`));
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            Где используется связь
          </button>
          {usages && (
            <ul>
              {usages.length ? (
                usages.map((u) => (
                  <li key={u.diagram.id}>
                    <a href={`/diagrams/${u.diagram.id}`}>{u.diagram.name}</a> · {u.count} стрелок
                  </li>
                ))
              ) : (
                <li>Нет представлений</li>
              )}
            </ul>
          )}
          <button
            className="secondary small"
            disabled={busy}
            onClick={async () => {
              try {
                setHistory(await api(`relations/${relation.id}/revisions`));
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            История связи
          </button>
          {history?.map((h) => (
            <div className="revision-row" key={h.number}>
              <span>
                #{h.number} · {h.snapshot.name} · {date(h.createdAt)}
              </span>
              <button
                className="secondary small"
                disabled={busy || h.number === relation.revision}
                onClick={async () => {
                  if (!confirm('Восстановить общие свойства связи?')) return;
                  setBusy(true);
                  try {
                    onSaved(
                      await api(`relations/${relation.id}/restore`, 'POST', {
                        ...guard,
                        number: h.number,
                      }),
                    );
                    onClose();
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Восстановить
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
export function RelationBrowser({
  relations,
  objects,
  counts,
  onEdit,
  onLocate,
  onPlace,
  onSaved,
  onRemove,
  onBeforeWrite,
  renderChildren,
  onMove,
  onCreateChild,
  isExpanded,
  onToggle,
}: {
  relations: ModelRelation[];
  objects: ModelObject[];
  counts: Map<string, number>;
  onEdit: (r?: ModelRelation) => void;
  onLocate: (id: string) => void;
  onPlace: (r: ModelRelation) => void;
  onSaved: (r: ModelRelation) => void;
  onRemove: (r: ModelRelation) => Promise<void>;
  onBeforeWrite: () => Promise<void>;
  renderChildren?: (id: string) => React.ReactNode;
  onMove?: (id: string, parent: string | null) => Promise<void>;
  onCreateChild?: (id: string) => void;
  isExpanded?: (id: string) => boolean;
  onToggle?: (id: string) => void;
}) {
  const [query, setQuery] = useState(''),
    [error, setError] = useState('');
  const name = (id: string) => objects.find((o) => o.id === id)?.name ?? id;
  return (
    <section aria-label="Связи модели" className="relation-browser">
      <div className="palette-title">
        <h3>Связи модели</h3>
        <button
          className="icon-button"
          aria-label="Создать связь модели"
          disabled={!objects.some((o) => !o.archived)}
          onClick={() => onEdit()}
        >
          <Plus size={14} />
        </button>
      </div>
      <input
        className="wide"
        aria-label="Поиск связей"
        placeholder="Найти связь…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && (
        <p className="error small-text" role="alert">
          {error}
        </p>
      )}
      {relations
        .filter((r) =>
          `${r.name} ${name(r.sourceId)} ${name(r.targetId)}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .map((r) => (
          <div key={r.id}>
            <div
              className={`object-tree-row tree-row ${onToggle ? '' : 'tree-row-leaf'} ${r.archived ? 'archived' : ''}`}
              data-model-relation-id={r.id}
              draggable={!r.archived}
              onDragStart={(e) => {
                e.dataTransfer.setData('application/maket-relation', r.id);
                e.dataTransfer.effectAllowed = 'copyMove';
              }}
              onDragOver={(e) => {
                if (
                  e.dataTransfer.types.some(
                    (t) => t === 'application/maket-object' || t === 'application/maket-relation',
                  )
                ) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(e) => {
                const id =
                  e.dataTransfer.getData('application/maket-object') ||
                  e.dataTransfer.getData('application/maket-relation');
                if (id) {
                  e.preventDefault();
                  e.stopPropagation();
                  void onMove?.(id, r.id);
                }
              }}
              key={r.id}
            >
              {onToggle && (
                <button
                  className="tree-toggle"
                  aria-label={`${isExpanded?.(r.id) ? 'Свернуть' : 'Развернуть'} связь ${r.name}`}
                  aria-expanded={isExpanded?.(r.id) ?? false}
                  onClick={() => onToggle(r.id)}
                >
                  <ChevronRight
                    size={14}
                    style={{ transform: isExpanded?.(r.id) ? 'rotate(90deg)' : undefined }}
                  />
                </button>
              )}
              <GitBranch className="tree-icon" size={16} />
              <button
                className="object-tree-name tree-label"
                onClick={() => onLocate(r.id)}
                onDoubleClick={() => onEdit(r)}
                title={r.name}
              >
                {r.name}
                {r.archived && <small>Архив</small>}
                <small>
                  {name(r.sourceId)} → {name(r.targetId)}
                </small>
              </button>
              <span className="badge tree-count">{counts.get(r.id) ?? 0}</span>
              <div className="object-tree-actions">
                <button
                  aria-label={`Создать дочерний объект связи ${r.name}`}
                  title="Создать дочерний объект"
                  disabled={r.archived}
                  onClick={() => onCreateChild?.(r.id)}
                >
                  <FolderPlus size={13} />
                </button>
                <button
                  title="Разместить стрелку этой связи"
                  aria-label={`Разместить связь ${r.name}`}
                  disabled={r.archived}
                  onClick={() => onPlace(r)}
                >
                  <Plus size={13} />
                </button>
                <button
                  title="Показать стрелку"
                  aria-label={`Найти связь ${r.name}`}
                  onClick={() => onLocate(r.id)}
                >
                  <LocateFixed size={12} />
                </button>
                <button
                  title="Изменить общие свойства"
                  aria-label={`Изменить связь ${r.name}`}
                  onClick={() => onEdit(r)}
                >
                  <Pencil size={12} />
                </button>
                <button
                  title="Создать независимую копию связи"
                  aria-label={`Копировать связь ${r.name}`}
                  onClick={async () => {
                    try {
                      await onBeforeWrite();
                      onSaved(
                        await api('relations', 'POST', {
                          name: `${r.name.slice(0, 90)} — копия`,
                          description: r.description,
                          sourceId: r.sourceId,
                          targetId: r.targetId,
                          attributes: r.attributes,
                          copyOf: r.id,
                        }),
                      );
                      setError('');
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                >
                  <Copy size={12} />
                </button>
                <button
                  title={r.archived ? 'Вернуть из архива' : 'Архивировать связь'}
                  aria-label={`${r.archived ? 'Восстановить' : 'Архивировать'} связь ${r.name}`}
                  onClick={async () => {
                    try {
                      await onBeforeWrite();
                      onSaved(
                        await api(`relations/${r.id}`, 'PATCH', {
                          revision: r.revision,
                          incarnation: r.incarnation,
                          archived: !r.archived,
                        }),
                      );
                      setError('');
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                >
                  <Archive size={12} />
                </button>
                <button
                  title="Удалить связь без представлений"
                  aria-label={`Удалить связь модели ${r.name}`}
                  onClick={async () => {
                    if (
                      !confirm(
                        `Удалить связь «${r.name}» и историю её общих свойств? Снимки диаграмм сохранятся.`,
                      )
                    )
                      return;
                    try {
                      await onRemove(r);
                      setError('');
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
            {renderChildren?.(r.id)}
          </div>
        ))}
      {!relations.length && (
        <p className="muted small-text">
          Связей пока нет. Создайте связь здесь или соедините представления на канвасе.
        </p>
      )}
    </section>
  );
}
export function RelationPlacement({
  relation,
  document,
  onPlace,
  onClose,
}: {
  relation: ModelRelation;
  document: ViewDocument;
  onPlace: (edge: ViewDocument['edges'][number]) => Promise<void>;
  onClose: () => void;
}) {
  const representations = [
    ...document.nodes.map((n) => ({ id: n.id, entityId: n.objectId })),
    ...document.edges.map((e) => ({ id: e.id, entityId: e.relationId })),
  ];
  const sources = representations.filter((n) => n.entityId === relation.sourceId),
    targets = representations.filter((n) => n.entityId === relation.targetId);
  const [source, setSource] = useState(sources[0]?.id ?? ''),
    [target, setTarget] = useState(targets[0]?.id ?? ''),
    [choice, setChoice] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const sourceNode = document.nodes.find((n) => n.id === source),
    targetNode = document.nodes.find((n) => n.id === target);
  const options = document.notation.connectionRules
    .filter(
      (r) =>
        r.source.nodeType === sourceNode?.typeId &&
        r.target.nodeType === targetNode?.typeId &&
        (source !== target || r.allowSelfLoop),
    )
    .map((r) => ({ typeId: r.edgeType, sourcePort: r.source.port, targetPort: r.target.port }));
  const sourceType = document.notation.nodeTypes.find((t) => t.id === sourceNode?.typeId),
    targetType = document.notation.nodeTypes.find((t) => t.id === targetNode?.typeId);
  for (const s of sourceType?.ports.filter((p) => p.direction === 'output') ??
    (document.edges.some((e) => e.id === source) ? [{ id: 'out' }, { id: 'in' }] : []))
    for (const t of targetType?.ports.filter((p) => p.direction === 'input') ??
      (document.edges.some((e) => e.id === target) ? [{ id: 'in' }, { id: 'out' }] : []))
      options.push({ typeId: 'universal:association', sourcePort: s.id, targetPort: t.id });
  const keys = options.map((o) => JSON.stringify(o));
  const selected = keys.includes(choice) ? choice : (keys[0] ?? '');
  const portLabel = (id: string, port: string) =>
    document.edges.some((e) => e.id === id)
      ? port === 'in'
        ? 'левая точка'
        : 'правая точка'
      : port;
  const nodeLabel = (id: string) => {
    const n = document.nodes.find((n) => n.id === id);
    if (!n) return `Стрелка · ${id.slice(0, 14)}`;
    return `${document.notation.nodeTypes.find((t) => t.id === n.typeId)?.name} · ${id.slice(0, 14)}`;
  };
  return (
    <Modal title={`Разместить связь «${relation.name}»`} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!selected) return;
          setBusy(true);
          try {
            const o = JSON.parse(selected);
            await onPlace({
              id: `edge-${crypto.randomUUID()}`,
              relationId: relation.id,
              ...o,
              source,
              target,
              properties: defaults(
                document.notation.edgeTypes.find((t) => t.id === o.typeId)!.properties,
              ),
            });
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="muted">
          Выберите представления участников и отображение стрелки. Общая связь останется той же.
        </p>
        {(
          [
            ['Представление источника', source, setSource, sources],
            ['Представление назначения', target, setTarget, targets],
          ] as const
        ).map(([label, value, setValue, nodes]) => (
          <label key={label}>
            {label}
            <select
              aria-label={label}
              value={value}
              required
              onChange={(e) => {
                setValue(e.target.value);
                setChoice('');
              }}
            >
              {!nodes.length && <option value="">Сначала разместите объект на канвасе</option>}
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {nodeLabel(n.id)}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          Отображение стрелки
          <select
            aria-label="Отображение стрелки"
            value={selected}
            onChange={(e) => setChoice(e.target.value)}
          >
            {!options.length && <option value="">Нет допустимых соединений</option>}
            {options.map((o, i) => (
              <option key={i} value={keys[i]}>
                {document.notation.edgeTypes.find((t) => t.id === o.typeId)?.name} ·{' '}
                {portLabel(source, o.sourcePort)} → {portLabel(target, o.targetPort)}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy || !selected}>
          Разместить стрелку
        </button>
      </form>
    </Modal>
  );
}
