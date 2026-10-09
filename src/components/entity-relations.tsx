'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { relationEntity, type ModelRelation } from '@/lib/model';
import type { Structure } from '@/lib/structure';
import { RelationEditor } from './relation-browser';

export function EntityRelations({
  entityId,
  onChanged,
}: {
  entityId?: string;
  onChanged?: () => void;
}) {
  const [space, setSpace] = useState<Structure | null>(null);
  const [editing, setEditing] = useState<ModelRelation | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const [solutionId, setSolutionId] = useState('');
  const [error, setError] = useState('');
  async function load() {
    try {
      setSpace(await api<Structure>('model/structure'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [entityId]);
  const entities = [...(space?.objects ?? []), ...(space?.relations.map(relationEntity) ?? [])];
  const name = (id: string) => entities.find((o) => o.id === id)?.name ?? id;
  const descendants = new Set(solutionId ? [solutionId] : []);
  if (solutionId) {
    let grew = true;
    while (grew) {
      grew = false;
      for (const o of entities)
        if (o.parentId && descendants.has(o.parentId) && !descendants.has(o.id)) {
          descendants.add(o.id);
          grew = true;
        }
    }
  }
  const relations = (space?.relations ?? []).filter(
    (r) =>
      (!entityId || r.sourceId === entityId || r.targetId === entityId) &&
      (!solutionId ||
        descendants.has(r.sourceId) ||
        descendants.has(r.targetId) ||
        descendants.has(r.id)) &&
      `${r.name} ${r.relationType ?? ''} ${name(r.sourceId)} ${name(r.targetId)}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section
      className="entity-relations"
      aria-label={entityId ? 'Связи элемента' : 'Менеджер связей'}
    >
      <div className="section-title">
        <strong>{entityId ? 'Связи элемента' : 'Все связи модели'}</strong>
        <button
          type="button"
          className="secondary small"
          disabled={!space || entities.filter((o) => !o.archived).length === 0}
          onClick={() => setEditing('new')}
        >
          Создать связь без диаграммы
        </button>
      </div>
      <p className="muted small-text">
        Вложенность не создаёт связи. Здесь можно связать любые активные элементы, включая
        диаграммы, независимо от их положения в дереве.
      </p>
      {!entityId && (
        <label>
          Решение
          <select
            aria-label="Фильтр решения"
            value={solutionId}
            onChange={(e) => setSolutionId(e.target.value)}
          >
            <option value="">Вся модель</option>
            {entities
              .filter((o) => o.kind === 'solution')
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <input
        aria-label="Поиск привязок"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Имя, тип или участник…"
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!space ? (
        <p className="muted">Загружаем связи…</p>
      ) : relations.length === 0 ? (
        <p className="muted">Связей пока нет.</p>
      ) : (
        <div className="model-links-list">
          {relations.map((r) => (
            <article key={r.id}>
              <div>
                <strong>{r.name}</strong>
                <small>
                  {r.relationType || 'Без типа'} · {name(r.sourceId)} → {name(r.targetId)}
                  {r.archived ? ' · Архив' : ''}
                </small>
                <small>
                  Представлений: {space.representations.filter((p) => p.entityId === r.id).length}
                </small>
              </div>
              <button
                type="button"
                className="secondary small"
                aria-label={`Редактировать привязку ${r.name}`}
                onClick={() => setEditing(r)}
              >
                Изменить
              </button>
              <button
                type="button"
                className="secondary small"
                aria-label={`Удалить привязку ${r.name}`}
                onClick={async () => {
                  if (!confirm(`Удалить связь «${r.name}»?`)) return;
                  try {
                    await api(`relations/${r.id}`, 'DELETE', {
                      revision: r.revision,
                      incarnation: r.incarnation,
                    });
                    await load();
                    onChanged?.();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Удалить
              </button>
            </article>
          ))}
        </div>
      )}
      {editing && (
        <RelationEditor
          key={editing === 'new' ? 'new' : `${editing.id}:${editing.revision}`}
          relation={editing === 'new' ? undefined : editing}
          sourceId={entityId}
          objects={entities}
          onSaved={() => {
            void load();
            onChanged?.();
          }}
          onClose={() => setEditing(null)}
        >
          {editing !== 'new' && <EntityRelations entityId={editing.id} onChanged={onChanged} />}
        </RelationEditor>
      )}
    </section>
  );
}
