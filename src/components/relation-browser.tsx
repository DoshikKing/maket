'use client';
import { useState } from 'react';
import { Plus, Pencil, Trash2, Archive, Copy, LocateFixed } from 'lucide-react';
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
  objects,
  onSaved,
  onClose,
}: {
  relation?: ModelRelation;
  objects: ModelObject[];
  onSaved: (r: ModelRelation) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(relation?.name ?? 'Новая связь'),
    [description, setDescription] = useState(relation?.description ?? ''),
    [source, setSource] = useState(relation?.sourceId ?? ''),
    [target, setTarget] = useState(relation?.targetId ?? ''),
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
  return (
    <Modal
      title={relation ? 'Общие свойства связи' : 'Создать связь модели'}
      onClose={onClose}
      className="object-modal"
    >
      <p className="muted small-text">
        Связь соединяет два объекта модели. Стрелки на диаграммах — её представления; их подписи и
        оформление могут различаться.
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
                  ...(relation ? guard : { sourceId: source, targetId: target }),
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
              disabled={!!relation}
              required
              onChange={(e) => setValue(e.target.value)}
            >
              <option value="">Выберите объект</option>
              {objects
                .filter((o) => !o.archived || o.id === value)
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
            Участники определяют связь и не меняются при смене её отображения.
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
          <div
            className={`object-tree-row ${r.archived ? 'archived' : ''}`}
            data-model-relation-id={r.id}
            key={r.id}
          >
            <button
              className="object-tree-name"
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
            <span className="badge">{counts.get(r.id) ?? 0}</span>
            <div className="object-tree-actions">
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
  const sources = document.nodes.filter((n) => n.objectId === relation.sourceId),
    targets = document.nodes.filter((n) => n.objectId === relation.targetId);
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
  for (const s of sourceType?.ports.filter((p) => p.direction === 'output') ?? [])
    for (const t of targetType?.ports.filter((p) => p.direction === 'input') ?? [])
      options.push({ typeId: 'universal:association', sourcePort: s.id, targetPort: t.id });
  const keys = options.map((o) => JSON.stringify(o));
  const selected = keys.includes(choice) ? choice : (keys[0] ?? '');
  const nodeLabel = (id: string) => {
    const n = document.nodes.find((n) => n.id === id)!;
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
                {document.notation.edgeTypes.find((t) => t.id === o.typeId)?.name} · {o.sourcePort}{' '}
                → {o.targetPort}
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
