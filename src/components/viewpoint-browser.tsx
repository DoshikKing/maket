'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client';
import type { Structure, Viewpoint } from '@/lib/structure';
import type { ModelDiagram } from '@/lib/model';
import { Modal } from './modal';

export function ViewpointExplorer({
  viewpoints,
  diagrams,
  currentDiagramId,
  onManage,
}: {
  viewpoints: Viewpoint[];
  diagrams: Structure['diagrams'];
  currentDiagramId?: string;
  onManage: () => void;
}) {
  const groups = [
    { id: '', name: 'Без ракурса', description: '' },
    ...[...viewpoints].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
  ];
  return (
    <section className="viewpoint-explorer" aria-label="Обозреватель ракурсов">
      <div className="palette-title">
        <strong>Ракурсы</strong>
        <button className="btn small" onClick={onManage} aria-label="Управление ракурсами">
          Настроить
        </button>
      </div>
      {groups.map((group) => {
        const items = diagrams.filter((d) => (d.viewpointId ?? '') === group.id);
        return (
          <details key={group.id} open data-viewpoint-group={group.id || 'unassigned'}>
            <summary title={group.description}>
              <span>{group.name}</span>
              <span className="tree-count">{items.length}</span>
            </summary>
            {items.map((diagram) => (
              <Link
                key={diagram.id}
                href={`/solutions?diagram=${encodeURIComponent(diagram.id)}`}
                className="viewpoint-explorer-diagram"
                aria-current={diagram.id === currentDiagramId ? 'page' : undefined}
              >
                {diagram.name}
              </Link>
            ))}
            {!items.length && <p className="muted small-text">Нет диаграмм</p>}
          </details>
        );
      })}
    </section>
  );
}

export function ViewpointBrowser({
  currentDiagramId,
  onClose,
  onChanged,
}: {
  currentDiagramId?: string;
  onClose: () => void;
  onChanged?: (diagram?: ModelDiagram) => void;
}) {
  const [space, setSpace] = useState<Pick<Structure, 'viewpoints' | 'diagrams'> | null>(null),
    [editing, setEditing] = useState<Viewpoint | null>(null),
    [name, setName] = useState(''),
    [description, setDescription] = useState(''),
    [order, setOrder] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setSpace(
        await api<Pick<Structure, 'viewpoints' | 'diagrams'>>('viewpoints?include=diagrams'),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  function edit(viewpoint: Viewpoint | null) {
    setEditing(viewpoint);
    setName(viewpoint?.name ?? '');
    setDescription(viewpoint?.description ?? '');
    setOrder(viewpoint?.order ?? 0);
  }
  const groups = [
    { id: '', name: 'Без ракурса', description: '', order: 0, revision: 0 },
    ...(space?.viewpoints ?? []),
  ];
  return (
    <Modal title="Ракурсы диаграмм" onClose={onClose} className="object-modal">
      <p className="muted">
        Ракурс описывает контекст диаграммы, например бизнес-процессы, развёртывание или код.
        Порядок групп не ограничивает переходы между ними.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await api(
              editing ? `viewpoints/${editing.id}` : 'viewpoints',
              editing ? 'PATCH' : 'POST',
              { name, description, order, ...(editing ? { revision: editing.revision } : {}) },
            );
            edit(null);
            await load();
            onChanged?.();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3>{editing ? 'Изменить ракурс' : 'Новый ракурс'}</h3>
        <label>
          Название ракурса
          <input
            aria-label="Название ракурса"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Описание ракурса
          <textarea
            aria-label="Описание ракурса"
            maxLength={4000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          Порядок в обозревателе
          <input
            aria-label="Порядок ракурса"
            required
            type="number"
            min={-1000000}
            max={1000000}
            value={order}
            onChange={(e) => setOrder(Number(e.target.value))}
          />
        </label>
        <div className="button-row">
          <button className="primary" disabled={busy}>
            {editing ? 'Сохранить ракурс' : 'Создать ракурс'}
          </button>
          {editing && (
            <button type="button" className="secondary" onClick={() => edit(null)}>
              Отмена
            </button>
          )}
        </div>
      </form>
      {!space && <p className="muted">Загружаем ракурсы…</p>}
      <div className="viewpoint-groups">
        {groups.map((group) => {
          const diagrams = space?.diagrams.filter((d) => (d.viewpointId ?? '') === group.id) ?? [];
          return (
            <details open key={group.id} data-viewpoint-group={group.id || 'unassigned'}>
              <summary>
                {group.name} · {diagrams.length} диаграмм
              </summary>
              {group.description && <p className="muted">{group.description}</p>}
              {group.id && (
                <div className="button-row">
                  <button
                    className="secondary small"
                    aria-label={`Изменить ракурс ${group.name}`}
                    onClick={() => edit(group)}
                  >
                    Изменить
                  </button>
                  <button
                    className="secondary small"
                    disabled={busy || diagrams.length > 0}
                    aria-label={`Удалить ракурс ${group.name}`}
                    onClick={async () => {
                      if (!confirm(`Удалить пустой ракурс «${group.name}»?`)) return;
                      setBusy(true);
                      setError('');
                      try {
                        await api(`viewpoints/${group.id}`, 'DELETE', { revision: group.revision });
                        await load();
                        if (editing?.id === group.id) edit(null);
                        onChanged?.();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Удалить пустой ракурс
                  </button>
                </div>
              )}
              {diagrams.map((d) => (
                <article className="viewpoint-diagram" key={d.id}>
                  <Link
                    href={`/solutions?diagram=${d.id}`}
                    aria-current={currentDiagramId === d.id ? 'page' : undefined}
                  >
                    {d.name}
                    {currentDiagramId === d.id ? ' · Открыта' : ''}
                  </Link>
                  <select
                    aria-label={`Ракурс диаграммы ${d.name}`}
                    value={d.viewpointId ?? ''}
                    disabled={busy}
                    onChange={async (e) => {
                      setBusy(true);
                      setError('');
                      try {
                        const result = await api<ModelDiagram>(
                          `diagrams/${d.id}/viewpoint`,
                          'PATCH',
                          { revision: d.revision, viewpointId: e.target.value || null },
                        );
                        await load();
                        onChanged?.(result);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </article>
              ))}
              {!diagrams.length && (
                <p className="muted small-text">В этом ракурсе пока нет диаграмм.</p>
              )}
            </details>
          );
        })}
      </div>
    </Modal>
  );
}
