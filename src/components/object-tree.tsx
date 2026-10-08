'use client';
import { useState } from 'react';
import {
  Plus,
  ChevronRight,
  RefreshCw,
  Copy,
  Archive,
  Pencil,
  LocateFixed,
  FolderPlus,
  Folder,
  Trash2,
  GitBranch,
  Box,
  Network,
  Workflow,
  FileText,
} from 'lucide-react';
import { api, date } from '@/lib/client';
import {
  attributesSchema,
  relationEntity,
  entityLabels,
  type ModelObject,
  type ModelRelation,
} from '@/lib/model';
import Link from 'next/link';
import { RepresentationFolder } from './representation-folder';
import { RelationFolder } from './relation-folder';
import type { Representation, Structure } from '@/lib/structure';
import { CopyOrigin } from './copy-origin';
import { Modal } from './modal';
export function ObjectEditor({
  object,
  kind = 'object',
  parentId,
  objects,
  onSaved,
  onClose,
}: {
  object?: ModelObject;
  kind?: ModelObject['kind'];
  parentId?: string | null;
  objects: ModelObject[];
  onSaved: (o: ModelObject) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(
      object?.name ??
        {
          solution: 'Новое решение',
          project: 'Новый проект',
          folder: 'Новая папка',
          diagram: 'Новая диаграмма',
          object: 'Новый объект',
        }[kind ?? 'object'],
    ),
    [description, setDescription] = useState(object?.description ?? ''),
    [parent, setParent] = useState(object?.parentId ?? parentId ?? ''),
    [attributes, setAttributes] = useState(
      Object.entries(object?.attributes ?? {}).map(([key, value]) => ({ key, value })),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [usages, setUsages] = useState<
      { count: number; diagram: { id: string; name: string } }[] | null
    >(null),
    [history, setHistory] = useState<
      { number: number; createdAt: string; snapshot: ModelObject }[] | null
    >(null);
  const forbidden = new Set(object ? [object.id] : []);
  let grew = true;
  while (grew) {
    grew = false;
    for (const o of objects)
      if (o.parentId && forbidden.has(o.parentId) && !forbidden.has(o.id)) {
        forbidden.add(o.id);
        grew = true;
      }
  }
  return (
    <Modal
      title={object ? 'Общие свойства объекта' : `Создать: ${entityLabels[kind ?? 'object']}`}
      onClose={onClose}
      className="object-modal"
    >
      <p className="muted small-text">
        Имя и атрибуты общие для всех представлений объекта. Вложенность организует дерево.
      </p>
      <CopyOrigin origin={object?.copiedFrom} />
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
            const result = await api<ModelObject>(
              object ? `objects/${object.id}` : 'objects',
              object ? 'PATCH' : 'POST',
              {
                ...(!object ? { kind } : {}),
                name,
                description,
                parentId: parent || null,
                attributes: values,
                ...(object ? { revision: object.revision, incarnation: object.incarnation } : {}),
              },
            );
            onSaved(result);
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Имя объекта
          <input
            aria-label="Имя объекта"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Описание объекта
          <textarea
            aria-label="Описание объекта"
            maxLength={4000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          Родительский объект
          <select
            aria-label="Родительский объект"
            value={parent}
            onChange={(e) => setParent(e.target.value)}
          >
            <option value="">Корень модели</option>
            {objects
              .filter((o) => !forbidden.has(o.id) && (!o.archived || o.id === parent))
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.archived ? ' (архив)' : ''}
                </option>
              ))}
          </select>
        </label>
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
              aria-label={`Ключ атрибута ${i + 1}`}
              placeholder="automated"
              value={a.key}
              maxLength={100}
              pattern="[a-zA-Z0-9_-]+"
              required
              onChange={(e) =>
                setAttributes(
                  attributes.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)),
                )
              }
            />
            <select
              aria-label={`Тип атрибута ${i + 1}`}
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
              <option value="boolean">Да / Нет</option>
            </select>
            {typeof a.value === 'boolean' ? (
              <label className="inline-check">
                <input
                  aria-label={`Значение атрибута ${i + 1}`}
                  type="checkbox"
                  checked={a.value}
                  onChange={(e) =>
                    setAttributes(
                      attributes.map((x, j) => (j === i ? { ...x, value: e.target.checked } : x)),
                    )
                  }
                />
                Да
              </label>
            ) : (
              <input
                aria-label={`Значение атрибута ${i + 1}`}
                type={typeof a.value === 'number' ? 'number' : 'text'}
                value={String(a.value)}
                maxLength={2000}
                onChange={(e) =>
                  setAttributes(
                    attributes.map((x, j) =>
                      j === i
                        ? {
                            ...x,
                            value:
                              typeof a.value === 'number' ? Number(e.target.value) : e.target.value,
                          }
                        : x,
                    ),
                  )
                }
              />
            )}
            <button
              type="button"
              className="secondary small danger"
              aria-label={`Удалить атрибут ${i + 1}`}
              onClick={() => setAttributes(attributes.filter((_, j) => i !== j))}
            >
              ×
            </button>
          </div>
        ))}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <button className="primary" disabled={busy}>
          {busy ? 'Сохраняем…' : 'Сохранить объект'}
        </button>
      </form>
      {object && (
        <div className="object-history">
          <button
            className="secondary small"
            onClick={async () => {
              try {
                setUsages(await api(`objects/${object.id}/usages`));
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            Использования объекта
          </button>
          {usages && (
            <div className="form-stack">
              {usages.length ? (
                usages.map((u) => (
                  <a key={u.diagram.id} href={`/diagrams/${u.diagram.id}`}>
                    {u.diagram.name} · {u.count} представлений
                  </a>
                ))
              ) : (
                <p className="muted">Объект пока не размещён на диаграммах.</p>
              )}
            </div>
          )}
          <button
            className="secondary small"
            onClick={async () => {
              try {
                setHistory(await api(`objects/${object.id}/revisions`));
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            История объекта
          </button>
          {history?.map((r) => (
            <div className="revision-row" key={r.number}>
              <span>
                v{r.number} · {r.snapshot.name}
                <small>{date(r.createdAt)}</small>
              </span>
              <button
                className="secondary small"
                disabled={r.number === object.revision || busy}
                onClick={async () => {
                  if (
                    !confirm(
                      'Восстановить общие свойства объекта? Это изменит все его представления.',
                    )
                  )
                    return;
                  setBusy(true);
                  try {
                    const result = await api<ModelObject>(`objects/${object.id}/restore`, 'POST', {
                      revision: object.revision,
                      incarnation: object.incarnation,
                      number: r.number,
                    });
                    onSaved(result);
                    onClose();
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Восстановить объект
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
export function ObjectTree({
  defaultParentId,
  diagramId,
  diagrams = [],
  representations,
  onRepresentationLocate,
  objects,
  counts,
  selectedId,
  onPlace,
  onLocate,
  onSaved,
  onRefresh,
  onRemove,
  relations = [],
  onRelationLocate,
  onRelationEdit,
  onRelationPlace,
  onRelationSaved,
  relationsPanel,
}: {
  defaultParentId?: string | null;
  diagramId?: string;
  diagrams?: Structure['diagrams'];
  representations?: Representation[];
  onRepresentationLocate?: (id: string, diagramId: string) => void;
  objects: ModelObject[];
  relations?: ModelRelation[];
  onRelationLocate?: (id: string) => void;
  onRelationEdit?: (r: ModelRelation) => void;
  relationsPanel?: (
    children: (id: string) => React.ReactNode,
    move: (id: string, parent: string | null) => Promise<void>,
    createChild: (id: string) => void,
  ) => React.ReactNode;
  onRelationPlace?: (r: ModelRelation) => void;
  onRelationSaved?: (r: ModelRelation) => void;
  counts: Map<string, number>;
  selectedId?: string;
  onPlace: (id: string) => void;
  onLocate: (id: string) => void;
  onSaved: (o: ModelObject) => void;
  onRefresh: () => void;
  onRemove: (object: ModelObject) => Promise<void>;
}) {
  const [query, setQuery] = useState(''),
    [collapsed, setCollapsed] = useState(new Set<string>()),
    [editing, setEditing] = useState<{ object?: ModelObject; parentId?: string | null } | null>(
      null,
    ),
    [error, setError] = useState('');
  const entities = [...objects, ...relations.map(relationEntity)];
  const relationIds = new Set(relations.map((r) => r.id));
  const editEntity = (o: ModelObject) => {
    const r = relations.find((r) => r.id === o.id);
    if (r) onRelationEdit?.(r);
    else setEditing({ object: o });
  };
  const savedEntity = (o: ModelObject) => {
    const r = relations.find((r) => r.id === o.id);
    if (r) onRelationSaved?.({ ...r, ...o });
    else onSaved(o);
  };
  const entityResource = (id: string) => (relationIds.has(id) ? 'relations' : 'objects');
  const visible = new Set(
    entities.filter((o) => o.name.toLowerCase().includes(query.toLowerCase())).map((o) => o.id),
  );
  if (query)
    for (const o of entities.filter((o) => visible.has(o.id))) {
      let p = o.parentId;
      while (p) {
        visible.add(p);
        p = entities.find((x) => x.id === p)?.parentId ?? null;
      }
    }
  async function move(id: string, parentId: string | null) {
    const o = entities.find((o) => o.id === id);
    if (!o) return;
    try {
      savedEntity(
        await api<ModelObject>(`${entityResource(id)}/${id}`, 'PATCH', {
          revision: o.revision,
          incarnation: o.incarnation,
          parentId,
        }),
      );
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  }
  function relationFolder(id: string, level: number) {
    const linked = relations.filter(
      (r) => r.id !== id && (r.parentId === id || r.sourceId === id || r.targetId === id),
    );
    return (
      <RelationFolder
        entityId={id}
        name={relations.find((r) => r.id === id)?.name ?? 'Связь'}
        count={linked.length}
        level={level}
      >
        {linked.map((r) => (
          <div key={r.id} role="treeitem" aria-level={level + 1}>
            <button
              className="solution-tree-select"
              onClick={() => onRelationLocate?.(r.id)}
              onDoubleClick={() => onRelationEdit?.(r)}
            >
              <GitBranch size={14} />
              <span>
                {r.name}
                <small>{r.parentId === id ? 'Дочерняя связь' : 'Ссылка'}</small>
              </span>
            </button>
          </div>
        ))}
      </RelationFolder>
    );
  }
  function branch(
    parentId: string | null,
    depth = 0,
    ancestors = new Set<string>(),
    objectsOnly = false,
  ): React.ReactNode {
    return entities
      .filter(
        (o) =>
          o.parentId === parentId &&
          (!objectsOnly || !relationIds.has(o.id)) &&
          visible.has(o.id) &&
          !ancestors.has(o.id) &&
          (parentId !== null || !relationIds.has(o.id)),
      )
      .map((o) => {
        const linked = relations.filter(
          (r) =>
            (r.sourceId === o.id || r.targetId === o.id || r.parentId === o.id) &&
            !ancestors.has(r.id),
        );
        const kind = relationIds.has(o.id) ? 'relation' : (o.kind ?? 'object');
        const Icon = {
          object: Box,
          solution: Network,
          project: Workflow,
          folder: Folder,
          diagram: FileText,
          relation: GitBranch,
        }[kind];
        const representable = !['folder', 'diagram'].includes(o.kind ?? 'object');
        const children =
            entities.some((c) => c.parentId === o.id) || linked.length > 0 || representable,
          closed = collapsed.has(o.id) && !query;
        return (
          <div
            key={o.id}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={children ? !closed : undefined}
            aria-selected={selectedId === o.id}
          >
            <div
              className={`object-tree-row ${selectedId === o.id ? 'selected' : ''} ${o.archived ? 'archived' : ''}`}
              title={`${entityLabels[kind]} · Родитель: ${entities.find((p) => p.id === o.parentId)?.name ?? 'Корень пространства'}`}
              draggable={!o.archived}
              data-object-id={o.id}
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  relationIds.has(o.id) ? 'application/maket-relation' : 'application/maket-object',
                  o.id,
                );
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
                  void move(id, o.id);
                }
              }}
            >
              <button
                className="tree-expander"
                aria-label={`${closed ? 'Развернуть' : 'Свернуть'} ${o.name}`}
                disabled={!children}
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(o.id)) next.delete(o.id);
                    else next.add(o.id);
                    return next;
                  })
                }
              >
                <ChevronRight
                  size={13}
                  style={{
                    transform: closed ? 'none' : 'rotate(90deg)',
                    opacity: children ? 1 : 0,
                  }}
                />
              </button>
              <Icon className="tree-entity-icon" size={15} aria-hidden="true" />
              <button
                className="object-tree-name"
                aria-label={o.name}
                title={`${o.name} · Родитель: ${entities.find((p) => p.id === o.parentId)?.name ?? 'Корень пространства'}`}
                onClick={() => {
                  const d = diagrams.find((d) => d.entityId === o.id);
                  if (d) window.location.assign(`/diagrams/${d.id}`);
                  else if (relationIds.has(o.id)) onRelationLocate?.(o.id);
                  else onLocate(o.id);
                }}
                onDoubleClick={() => editEntity(o)}
              >
                {o.name}
                <small>{entityLabels[kind]}</small>
                {o.archived && <small>Архив</small>}
              </button>
              <span className="badge">{counts.get(o.id) ?? 0}</span>
              <div className="object-tree-actions">
                <Link
                  href={`/solutions?parent=${o.id}`}
                  aria-label={`Декомпозиция ${o.name}`}
                  title="Дочерние элементы и диаграммы"
                >
                  <GitBranch size={12} />
                </Link>
                <button
                  aria-label={`Разместить ${o.name}`}
                  title="Ещё одно представление"
                  disabled={o.archived || !representable}
                  onClick={() => {
                    const r = relations.find((r) => r.id === o.id);
                    if (r) onRelationPlace?.(r);
                    else onPlace(o.id);
                  }}
                >
                  <Plus size={13} />
                </button>
                <button
                  aria-label={`Найти объект ${o.name}`}
                  title="Показать представление на диаграмме"
                  onClick={() =>
                    relationIds.has(o.id) ? onRelationLocate?.(o.id) : onLocate(o.id)
                  }
                >
                  <LocateFixed size={12} />
                </button>
                <button aria-label={`Изменить объект ${o.name}`} onClick={() => editEntity(o)}>
                  <Pencil size={12} />
                </button>
                <button
                  aria-label={`Создать дочерний объект ${o.name}`}
                  title="Создать дочерний объект"
                  disabled={o.archived}
                  onClick={() => setEditing({ parentId: o.id })}
                >
                  <FolderPlus size={12} />
                </button>
                {!relationIds.has(o.id) && (
                  <>
                    <button
                      hidden={o.kind === 'diagram'}
                      aria-label={`Копировать объект ${o.name}`}
                      disabled={o.archived}
                      onClick={async () => {
                        try {
                          onSaved(
                            await api<ModelObject>('objects', 'POST', {
                              name: `${o.name.slice(0, 90)} — копия`,
                              copyOf: o.id,
                              description: o.description,
                              attributes: o.attributes,
                              parentId: o.parentId,
                              kind: o.kind,
                            }),
                          );
                        } catch (err) {
                          setError((err as Error).message);
                        }
                      }}
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      aria-label={`${o.archived ? 'Вернуть из архива' : 'Архивировать'} ${o.name}`}
                      onClick={async () => {
                        try {
                          if (!o.archived) {
                            const usages = await api<
                              { count: number; diagram: { name: string } }[]
                            >(`objects/${o.id}/usages`);
                            if (
                              !confirm(
                                `Архивировать «${o.name}»? Использований: ${usages.reduce((sum, u) => sum + u.count, 0)}. Представления и дочерние объекты сохранятся.`,
                              )
                            )
                              return;
                          }
                          onSaved(
                            await api<ModelObject>(`objects/${o.id}`, 'PATCH', {
                              revision: o.revision,
                              incarnation: o.incarnation,
                              archived: !o.archived,
                            }),
                          );
                        } catch (err) {
                          setError((err as Error).message);
                        }
                      }}
                    >
                      <Archive size={12} />
                    </button>
                    <button
                      aria-label={`Удалить объект ${o.name}`}
                      title="Удалить неиспользуемый объект"
                      onClick={async () => {
                        if (
                          !confirm(
                            `Удалить объект «${o.name}» и историю его общих свойств? Исторические снимки диаграмм сохранятся. Объекты с представлениями или детьми удалить нельзя.`,
                          )
                        )
                          return;
                        try {
                          await onRemove(o);
                          setError('');
                        } catch (err) {
                          setError((err as Error).message);
                        }
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </div>
            </div>
            {children && !closed && (
              <div role="group" className="hierarchy-children">
                {representable && (
                  <RepresentationFolder
                    resource={relationIds.has(o.id) ? 'relations' : 'objects'}
                    entityId={o.id}
                    level={depth + 2}
                    localItems={representations}
                    currentDiagramId={diagramId}
                    onLocate={onRepresentationLocate}
                  />
                )}
                {(representable || linked.length > 0) && (
                  <RelationFolder
                    entityId={o.id}
                    name={o.name}
                    count={linked.length}
                    level={depth + 2}
                  >
                    {linked.map((r) => (
                      <div key={r.id}>
                        <div
                          role="treeitem"
                          key={r.id}
                          data-relation-reference={r.id}
                          draggable={!r.archived}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('application/maket-relation', r.id);
                            e.dataTransfer.effectAllowed = 'copyMove';
                          }}
                          onDragOver={(e) => {
                            if (
                              e.dataTransfer.types.some(
                                (t) =>
                                  t === 'application/maket-object' ||
                                  t === 'application/maket-relation',
                              )
                            ) {
                              e.preventDefault();
                              e.stopPropagation();
                            }
                          }}
                          onDrop={(e) => {
                            const id =
                              e.dataTransfer.getData('application/maket-object') ||
                              e.dataTransfer.getData('application/maket-relation');
                            if (id) {
                              e.preventDefault();
                              e.stopPropagation();
                              void move(id, r.id);
                            }
                          }}
                          className={`object-relation-reference ${r.archived ? 'archived' : ''}`}
                        >
                          <button
                            title={`${r.name} · Родитель: ${entities.find((p) => p.id === r.parentId)?.name ?? 'Корень пространства'}`}
                            onClick={() => onRelationLocate?.(r.id)}
                            onDoubleClick={() => onRelationEdit?.(r)}
                          >
                            {r.sourceId === o.id ? '→' : '←'} {r.name}
                            <small>
                              {
                                entities.find(
                                  (x) => x.id === (r.sourceId === o.id ? r.targetId : r.sourceId),
                                )?.name
                              }
                              {r.parentId === o.id ? ' · Дочерняя связь' : ' · Ссылка'}
                            </small>
                          </button>
                          <button
                            aria-label={`Вернуть представление связи ${r.name}`}
                            title="Разместить стрелку на диаграмме"
                            disabled={r.archived}
                            onClick={() => onRelationPlace?.(r)}
                          >
                            <Plus size={12} />
                          </button>
                          <button
                            aria-label={`Создать дочерний объект связи ${r.name}`}
                            title="Создать дочерний объект"
                            disabled={r.archived}
                            onClick={() => setEditing({ parentId: r.id })}
                          >
                            <FolderPlus size={12} />
                          </button>
                          <button
                            aria-label={`Свойства вложенной связи ${r.name}`}
                            onClick={() => onRelationEdit?.(r)}
                          >
                            <Pencil size={12} />
                          </button>
                        </div>
                        <div className="hierarchy-children">
                          <RepresentationFolder
                            resource="relations"
                            entityId={r.id}
                            level={depth + 4}
                            localItems={representations}
                            currentDiagramId={diagramId}
                            onLocate={onRepresentationLocate}
                          />
                          {relationFolder(r.id, depth + 4)}
                          {branch(r.id, depth + 3, new Set([...ancestors, o.id, r.id]), true)}
                        </div>
                      </div>
                    ))}
                  </RelationFolder>
                )}
                {branch(o.id, depth + 1, new Set([...ancestors, o.id]), true)}
              </div>
            )}
          </div>
        );
      });
  }
  return (
    <aside className="object-panel" aria-label="Дерево объектов">
      <div className="palette-title">
        <h3>Объекты модели</h3>
        <div className="button-row">
          <button className="icon-button" aria-label="Обновить модель" onClick={onRefresh}>
            <RefreshCw size={14} />
          </button>
          <button
            className="icon-button"
            aria-label="Создать объект"
            onClick={() => setEditing({ parentId: defaultParentId })}
          >
            <Plus size={15} />
          </button>
        </div>
      </div>
      <input
        aria-label="Поиск объектов"
        className="object-search"
        placeholder="Найти объект…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div
        className="tree-root-drop"
        onDragOver={(e) => {
          if (
            e.dataTransfer.types.some(
              (t) => t === 'application/maket-object' || t === 'application/maket-relation',
            )
          )
            e.preventDefault();
        }}
        onDrop={(e) => {
          const id =
            e.dataTransfer.getData('application/maket-object') ||
            e.dataTransfer.getData('application/maket-relation');
          if (id) {
            e.preventDefault();
            void move(id, null);
          }
        }}
      >
        Корень модели · {objects.length} объектов
      </div>
      <div className="object-tree" role="tree" aria-label="Объекты">
        {branch(null)}
      </div>
      {!objects.length && (
        <p className="muted small-text">Создайте объект здесь или добавьте элемент из палитры.</p>
      )}
      <p className="muted small-text">
        Перетащите объект на канвас. Число справа — представления на этой диаграмме.
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {relationsPanel?.(
        (id) => (
          <div className="hierarchy-children" role="group">
            <RepresentationFolder
              resource="relations"
              entityId={id}
              level={2}
              localItems={representations}
              currentDiagramId={diagramId}
              onLocate={onRepresentationLocate}
            />
            {relationFolder(id, 2)}
            {branch(id, 1, new Set([id]), true)}
          </div>
        ),
        move,
        (id) => setEditing({ parentId: id }),
      )}
      {editing && (
        <ObjectEditor
          object={editing.object}
          parentId={editing.parentId}
          objects={entities}
          onSaved={onSaved}
          onClose={() => setEditing(null)}
        />
      )}
    </aside>
  );
}
