'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ChevronRight,
  Folder,
  Box,
  Network,
  GitBranch,
  Workflow,
  FileText,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { api } from '@/lib/client';
import { entityLabels, relationEntity, type ModelObject, type ModelDiagram } from '@/lib/model';
import type { Structure } from '@/lib/structure';
import { ObjectEditor } from './object-tree';
import { RelationEditor } from './relation-browser';
import { RepresentationFolder } from './representation-folder';
import { RelationFolder } from './relation-folder';
import { Modal } from './modal';
import type { NotationItem } from './library';
import { useTreeExpansion } from './use-tree-expansion';
import { EntityRelations } from './entity-relations';
import { TreeContextMenu } from './tree-context-menu';
const icons = {
  solution: Network,
  project: Workflow,
  folder: Folder,
  object: Box,
  diagram: FileText,
  relation: GitBranch,
};
type Kind = keyof typeof icons;
export function SolutionsPage() {
  const [space, setSpace] = useState<Structure | null>(null),
    [notations, setNotations] = useState<NotationItem[]>([]),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [kind, setKind] = useState<Kind>('solution'),
    [creating, setCreating] = useState(false),
    [editing, setEditing] = useState(false),
    [linksOpen, setLinksOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [diagramName, setDiagramName] = useState('Новая диаграмма'),
    [notationIds, setNotationIds] = useState<string[]>(['builtin']);
  async function load() {
    try {
      const [s, n] = await Promise.all([
        api<Structure>('model/structure'),
        api<NotationItem[]>('notations'),
      ]);
      setSpace(s);
      setNotations(n);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  }
  useEffect(() => {
    setSelectedId(new URLSearchParams(window.location.search).get('parent'));
    void load();
  }, []);
  const relationIds = new Set(space?.relations.map((r) => r.id));
  const entities = [...(space?.objects ?? []), ...(space?.relations.map(relationEntity) ?? [])];
  const expansion = useTreeExpansion(entities, selectedId);
  const entityKind = (o: ModelObject): Kind =>
    relationIds.has(o.id) ? 'relation' : (o.kind ?? 'object');
  const selected = entities.find((o) => o.id === selectedId);
  const children = entities.filter((o) => o.parentId === (selected?.id ?? null));
  const ancestors: ModelObject[] = [];
  let ancestor = selected;
  while (ancestor && !ancestors.some((a) => a.id === ancestor!.id)) {
    ancestors.unshift(ancestor);
    ancestor = entities.find((o) => o.id === ancestor?.parentId);
  }
  const visible = new Set(
    entities.filter((o) => o.name.toLowerCase().includes(query.toLowerCase())).map((o) => o.id),
  );
  for (const o of entities.filter((o) => visible.has(o.id))) {
    let p = entities.find((x) => x.id === o.parentId);
    const seen = new Set<string>();
    while (p && !seen.has(p.id)) {
      seen.add(p.id);
      visible.add(p.id);
      p = entities.find((x) => x.id === p!.parentId);
    }
  }
  function select(id: string | null) {
    setSelectedId(id);
    const entity = entities.find((o) => o.id === id);
    setKind(!id ? 'solution' : entity?.kind === 'solution' ? 'project' : 'object');
    window.history.replaceState(
      null,
      '',
      id ? `/solutions?parent=${encodeURIComponent(id)}` : '/solutions',
    );
  }
  async function move(id: string, parentId: string | null) {
    const o = entities.find((o) => o.id === id);
    if (!o) return;
    try {
      await api(`${relationIds.has(id) ? 'relations' : 'objects'}/${id}`, 'PATCH', {
        revision: o.revision,
        incarnation: o.incarnation,
        parentId,
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function remove(target = selected) {
    if (
      !target ||
      !confirm(
        `Удалить «${target.name}»? Элементы с дочерними элементами или представлениями удалить нельзя.`,
      )
    )
      return;
    setBusy(true);
    try {
      const d = space?.diagrams.find((d) => d.entityId === target.id);
      await api(
        d
          ? `diagrams/${d.id}`
          : `${relationIds.has(target.id) ? 'relations' : 'objects'}/${target.id}`,
        'DELETE',
        d ? undefined : { revision: target.revision, incarnation: target.incarnation },
      );
      select(target.parentId);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function actions(o: ModelObject) {
    const diagram = space?.diagrams.find((d) => d.entityId === o.id);
    return (
      <>
        <button
          title="Свойства"
          aria-label={`Свойства ${o.name}`}
          onClick={() => {
            select(o.id);
            setEditing(true);
          }}
        >
          <Pencil size={14} />
        </button>
        {diagram && (
          <Link
            href={`/solutions?diagram=${diagram.id}`}
            title="Открыть диаграмму"
            aria-label={`Открыть диаграмму ${o.name}`}
          >
            <FileText size={14} />
          </Link>
        )}
        <button
          title="Создать внутри"
          aria-label={`Создать внутри ${o.name}`}
          disabled={o.archived}
          onClick={() => {
            select(o.id);
            setError('');
            setCreating(true);
          }}
        >
          <Plus size={14} />
        </button>
        <button
          title="Удалить"
          aria-label={`Удалить ${o.name}`}
          disabled={busy}
          onClick={() => void remove(o)}
        >
          <Trash2 size={14} />
        </button>
      </>
    );
  }
  function linkedRelations(id: string, ancestors = new Set<string>()) {
    return (space?.relations ?? []).filter(
      (r) =>
        r.id !== id &&
        !ancestors.has(r.id) &&
        (r.parentId === id || r.sourceId === id || r.targetId === id),
    );
  }
  function relationFolder(id: string, name: string, level?: number) {
    const linked = linkedRelations(id);
    return (
      <RelationFolder
        key={`relations:${id}`}
        entityId={id}
        name={name}
        count={linked.length}
        level={level}
      >
        {linked.map((r) => (
          <div
            key={r.id}
            role={level ? 'treeitem' : undefined}
            aria-level={level ? level + 1 : undefined}
          >
            <TreeContextMenu actions={actions(relationEntity(r))}>
              <button
                className="solution-tree-select tree-row tree-row-leaf"
                onClick={() => select(r.id)}
              >
                <GitBranch className="tree-icon" size={16} />
                <span className="tree-label">
                  {r.name}
                  <small>{r.parentId === id ? 'Дочерняя связь' : 'Ссылка'}</small>
                </span>
              </button>
            </TreeContextMenu>
          </div>
        ))}
      </RelationFolder>
    );
  }
  function tree(
    parentId: string | null,
    depth = 0,
    ancestors = new Set<string>(),
  ): React.ReactNode {
    return entities
      .filter(
        (o) =>
          o.parentId === parentId &&
          !ancestors.has(o.id) &&
          visible.has(o.id) &&
          (parentId === null || !relationIds.has(o.id)),
      )
      .map((o) => {
        const Icon = icons[entityKind(o)],
          linked = linkedRelations(o.id, ancestors),
          hasChildren =
            entities.some((c) => c.parentId === o.id) ||
            !['folder', 'diagram'].includes(o.kind ?? 'object') ||
            linked.length > 0,
          collapsed = !expansion.isExpanded(o.id) && !query;
        return (
          <div
            key={o.id}
            data-tree-entity={o.id}
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={selected?.id === o.id}
            aria-expanded={hasChildren ? !collapsed : undefined}
          >
            <TreeContextMenu
              actions={actions(o)}
              className={`solution-tree-row tree-row ${selected?.id === o.id ? 'selected' : ''}`}
              title={`${entityLabels[entityKind(o)]} · Родитель: ${entities.find((p) => p.id === o.parentId)?.name ?? 'Корень пространства'}`}
              draggable={!o.archived}
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.setData('application/maket-entity', o.id);
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/maket-entity')) e.preventDefault();
              }}
              onDrop={(e) => {
                const id = e.dataTransfer.getData('application/maket-entity');
                if (id) {
                  e.preventDefault();
                  e.stopPropagation();
                  void move(id, o.id);
                }
              }}
            >
              <button
                className="icon-button tree-toggle"
                aria-label={`${collapsed ? 'Развернуть' : 'Свернуть'} ${o.name}`}
                disabled={!hasChildren}
                onClick={() => expansion.toggle(o.id)}
              >
                <ChevronRight
                  size={14}
                  style={{
                    opacity: hasChildren ? 1 : 0,
                    transform: collapsed ? undefined : 'rotate(90deg)',
                  }}
                />
              </button>
              <button
                className="solution-tree-select tree-label"
                aria-label={o.name}
                onClick={() => select(o.id)}
              >
                <Icon className="tree-icon" size={16} />
                <span>
                  {o.name}
                  <small>{entityLabels[entityKind(o)]}</small>
                  {o.archived && <small>Архив</small>}
                </span>
              </button>
            </TreeContextMenu>
            {hasChildren && !collapsed && (
              <div role="group" className="hierarchy-children">
                {!['folder', 'diagram'].includes(o.kind ?? 'object') && (
                  <RepresentationFolder
                    entityId={o.id}
                    items={space?.representations}
                    level={depth + 2}
                  />
                )}
                {(!['folder', 'diagram'].includes(o.kind ?? 'object') || linked.length > 0) && (
                  <RelationFolder
                    entityId={o.id}
                    name={o.name}
                    level={depth + 2}
                    count={linked.length}
                  >
                    {linked.map((r) => (
                      <div
                        key={r.id}
                        role="treeitem"
                        aria-expanded={expansion.isExpanded(r.id)}
                        aria-level={depth + 3}
                        draggable={!r.archived}
                        onDragStart={(e) => {
                          e.stopPropagation();
                          e.dataTransfer.setData('application/maket-entity', r.id);
                        }}
                        onDragOver={(e) => {
                          if (e.dataTransfer.types.includes('application/maket-entity'))
                            e.preventDefault();
                        }}
                        onDrop={(e) => {
                          const id = e.dataTransfer.getData('application/maket-entity');
                          if (id) {
                            e.preventDefault();
                            e.stopPropagation();
                            void move(id, r.id);
                          }
                        }}
                      >
                        <TreeContextMenu actions={actions(relationEntity(r))} className="tree-row">
                          <button
                            className="tree-toggle"
                            aria-label={`${expansion.isExpanded(r.id) ? 'Свернуть' : 'Развернуть'} связь ${r.name}`}
                            onClick={() => expansion.toggle(r.id)}
                          >
                            <ChevronRight
                              size={14}
                              style={{
                                transform: expansion.isExpanded(r.id) ? 'rotate(90deg)' : undefined,
                              }}
                            />
                          </button>
                          <button
                            className="solution-tree-select tree-label"
                            onClick={() => select(r.id)}
                          >
                            <GitBranch className="tree-icon" size={16} />
                            <span className="tree-label">
                              {r.name}
                              <small>{r.parentId === o.id ? 'Дочерняя связь' : 'Ссылка'}</small>
                            </span>
                          </button>
                        </TreeContextMenu>
                        {expansion.isExpanded(r.id) && (
                          <div className="hierarchy-children" role="group">
                            <RepresentationFolder
                              entityId={r.id}
                              items={space?.representations}
                              level={depth + 4}
                            />
                            {relationFolder(r.id, r.name, depth + 4)}
                            {tree(r.id, depth + 3, new Set([...ancestors, o.id, r.id]))}
                          </div>
                        )}
                      </div>
                    ))}
                  </RelationFolder>
                )}
                {tree(o.id, depth + 1, new Set([...ancestors, o.id]))}
              </div>
            )}
          </div>
        );
      });
  }
  return (
    <main className="page solutions-page">
      <div className="page-heading">
        <button className="secondary" onClick={() => setLinksOpen(true)}>
          <GitBranch size={16} />
          Менеджер связей
        </button>
        <div>
          <div className="eyebrow">ОТ РЕШЕНИЯ К ДЕТАЛЯМ</div>
          <h1>Решения</h1>
          <p className="muted">Единая модель, проекты и диаграммы на каждом уровне декомпозиции.</p>
        </div>
        <button className="secondary" onClick={() => void load()}>
          <RefreshCw size={16} /> Обновить
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {!space ? (
        <p className="muted">Загружаем модель…</p>
      ) : (
        <div className="solutions-layout">
          <aside className="solutions-tree">
            <input
              aria-label="Поиск в решениях"
              placeholder="Поиск в модели…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              className="tree-root-drop"
              onClick={() => select(null)}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/maket-entity')) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                void move(e.dataTransfer.getData('application/maket-entity'), null);
              }}
            >
              Корень пространства
            </button>
            <div role="tree" aria-label="Структура решений">
              {tree(null)}
            </div>
            {entities.length === 0 && (
              <p className="muted small-text">Создайте первое решение. Дерево изначально пустое.</p>
            )}
          </aside>
          <section className="solution-content">
            <nav className="solution-breadcrumb" aria-label="Путь в модели">
              <button onClick={() => select(null)}>Пространство</button>
              {ancestors.map((o) => (
                <span key={o.id}>
                  <ChevronRight size={13} />
                  <button onClick={() => select(o.id)}>{o.name}</button>
                </span>
              ))}
            </nav>
            <div className="solution-heading">
              <div>
                <span className="eyebrow">
                  {selected ? entityLabels[entityKind(selected)] : 'КОРЕНЬ'}
                </span>
                <h2>{selected?.name ?? 'Модель решений'}</h2>
              </div>
              {selected && (
                <div className="button-row">
                  <button className="secondary small" onClick={() => setEditing(true)}>
                    <Pencil size={14} /> Свойства
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Удалить выбранный элемент"
                    disabled={busy}
                    onClick={() => void remove()}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </div>
            {selected?.description && <p className="muted">{selected.description}</p>}
            {selected?.kind === 'diagram' &&
              space.diagrams.some((d) => d.entityId === selected.id) && (
                <Link
                  className="primary"
                  href={`/solutions?diagram=${space.diagrams.find((d) => d.entityId === selected.id)?.id}`}
                >
                  Открыть диаграмму →
                </Link>
              )}
            <div className="solution-create">
              <select
                aria-label="Тип нового элемента"
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
              >
                {Object.keys(icons).map((k) => (
                  <option key={k} value={k}>
                    {entityLabels[k as Kind]}
                  </option>
                ))}
              </select>
              <button
                className="primary"
                disabled={selected?.archived}
                onClick={() => {
                  setError('');
                  setCreating(true);
                }}
              >
                <Plus size={16} /> Создать внутри
              </button>
            </div>
            <p className="muted small-text">
              Дочерние элементы образуют декомпозицию. Одна сущность может иметь несколько
              представлений на разных диаграммах.
            </p>
            {selected && !['folder', 'diagram'].includes(selected.kind ?? '') && (
              <>
                <RepresentationFolder
                  key={selected.id}
                  entityId={selected.id}
                  items={space.representations}
                />
              </>
            )}
            {selected &&
              (!['folder', 'diagram'].includes(selected.kind ?? '') ||
                linkedRelations(selected.id).length > 0) &&
              relationFolder(selected.id, selected.name)}
            <div className="solution-cards">
              {children
                .filter((o) => !selected || !relationIds.has(o.id))
                .map((o) => {
                  const Icon = icons[entityKind(o)];
                  const diagram = space.diagrams.find((d) => d.entityId === o.id);
                  return (
                    <article className="solution-card" key={o.id}>
                      <button onClick={() => select(o.id)}>
                        <Icon size={23} />
                        <strong>{o.name}</strong>
                        <small>
                          {entityLabels[entityKind(o)]}
                          {o.archived ? ' · Архив' : ''}
                        </small>
                      </button>
                      {diagram && (
                        <Link href={`/solutions?diagram=${diagram.id}`}>Открыть диаграмму →</Link>
                      )}
                    </article>
                  );
                })}
            </div>
            {children.length === 0 && (
              <p className="muted">На этом уровне пока нет дочерних элементов.</p>
            )}
          </section>
        </div>
      )}
      {creating && kind !== 'diagram' && kind !== 'relation' && (
        <ObjectEditor
          kind={kind}
          parentId={selected?.id ?? null}
          objects={entities}
          onClose={() => setCreating(false)}
          onSaved={(o) => {
            select(o.id);
            setKind(o.kind === 'solution' ? 'project' : 'object');
            void load();
          }}
        />
      )}
      {linksOpen && (
        <Modal title="Менеджер связей" onClose={() => setLinksOpen(false)} className="object-modal">
          <EntityRelations onChanged={() => void load()} />
        </Modal>
      )}
      {creating && kind === 'relation' && (
        <RelationEditor
          parentId={selected?.id ?? null}
          objects={entities}
          onClose={() => setCreating(false)}
          onSaved={(r) => {
            select(r.id);
            void load();
          }}
        />
      )}
      {editing && selected && !relationIds.has(selected.id) && (
        <ObjectEditor
          onRelationsChanged={() => void load()}
          object={selected}
          objects={entities}
          onClose={() => setEditing(false)}
          onSaved={() => void load()}
        />
      )}
      {editing && selected && relationIds.has(selected.id) && (
        <RelationEditor
          relation={space?.relations.find((r) => r.id === selected.id)}
          objects={entities}
          onClose={() => setEditing(false)}
          onSaved={() => void load()}
        >
          <EntityRelations entityId={selected.id} onChanged={() => void load()} />
        </RelationEditor>
      )}
      {creating && kind === 'diagram' && (
        <Modal title="Создать диаграмму декомпозиции" onClose={() => setCreating(false)}>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const d = await api<ModelDiagram>('diagrams', 'POST', {
                  name: diagramName,
                  parentId: selected?.id ?? null,
                  notationIds,
                });
                setCreating(false);
                select(d.entityId ?? null);
                await load();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <label>
              Название
              <input
                value={diagramName}
                onChange={(e) => setDiagramName(e.target.value)}
                required
                maxLength={100}
              />
            </label>
            <p className="muted">
              Расположение: {selected?.name ?? 'Корень пространства'}. Можно подключить несколько
              нотаций.
            </p>
            {notations.map((n) => (
              <label className="checkbox-row" key={n.id}>
                <input
                  type="checkbox"
                  checked={notationIds.includes(n.id)}
                  onChange={(e) =>
                    setNotationIds((ids) =>
                      e.target.checked ? [...ids, n.id] : ids.filter((id) => id !== n.id),
                    )
                  }
                />
                {n.name}
              </label>
            ))}
            <button className="primary" disabled={busy || !notationIds.length}>
              {busy ? 'Создаём…' : 'Создать диаграмму'}
            </button>
          </form>
        </Modal>
      )}
    </main>
  );
}
