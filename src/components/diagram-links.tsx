'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client';
import type { Structure, DiagramContextLink } from '@/lib/structure';
import { Modal } from './modal';
import { ViewpointBrowser } from './viewpoint-browser';

export function contextLinkUrl(link: DiagramContextLink, space: Structure) {
  // ponytail: resolve the first live alias; pin a representation only if a specific alias is needed.
  const representation =
    link.kind === 'viewpoint'
      ? space.representations.find(
          (r) => r.entityId === link.entityId && r.diagramId === link.targetDiagramId,
        )
      : undefined;
  return `/solutions?diagram=${link.targetDiagramId}${representation ? `&element=${encodeURIComponent(representation.id)}` : ''}`;
}
export function DiagramLinks({
  entityId,
  sourceDiagramId,
  initialKind = 'decomposition',
  onClose,
  onChanged,
}: {
  entityId: string;
  sourceDiagramId?: string;
  initialKind?: DiagramContextLink['kind'];
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [space, setSpace] = useState<Structure | null>(null),
    [kind, setKind] = useState(initialKind),
    [sourceId, setSourceId] = useState(sourceDiagramId ?? ''),
    [mode, setMode] = useState('existing'),
    [targetId, setTargetId] = useState(''),
    [newName, setNewName] = useState(''),
    [viewpointId, setViewpointId] = useState(''),
    [meaning, setMeaning] = useState(''),
    [editingMeaning, setEditingMeaning] = useState<{
      link: DiagramContextLink;
      value: string;
    } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [viewpointsOpen, setViewpointsOpen] = useState(false);
  async function load() {
    try {
      setSpace(
        await api<Structure>(
          `context-links?entityId=${encodeURIComponent(entityId)}&include=structure`,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [entityId]);
  const entity =
    space?.objects.find((o) => o.id === entityId) ??
    space?.relations.find((r) => r.id === entityId);
  const source = space?.diagrams.find((d) => d.id === sourceId);
  const newViewAllowed = !!space?.objects.some(
    (o) => o.id === entityId && !['folder', 'diagram'].includes(o.kind ?? 'object'),
  );
  const targets =
    space?.diagrams.filter(
      (d) =>
        d.id !== sourceId &&
        (kind === 'decomposition'
          ? !source || d.viewpointId === source.viewpointId
          : space.representations.some((r) => r.diagramId === d.id && r.entityId === entityId)),
    ) ?? [];
  useEffect(() => {
    setTargetId('');
    if (kind === 'decomposition' && source) setViewpointId(source.viewpointId ?? '');
    if (kind === 'viewpoint' && !newViewAllowed) setMode('existing');
  }, [kind, sourceId, source?.viewpointId, newViewAllowed]);
  const groupName = (id: string | null) =>
    space?.viewpoints.find((v) => v.id === id)?.name ?? 'Без ракурса';
  const links =
    space?.contextLinks.filter(
      (l) =>
        l.entityId === entityId &&
        (!sourceDiagramId ||
          l.sourceDiagramId === sourceDiagramId ||
          (l.sourceDiagramId === null &&
            (l.kind === 'viewpoint' ||
              space.diagrams.find((d) => d.id === l.targetDiagramId)?.viewpointId ===
                source?.viewpointId))),
    ) ?? [];
  return (
    <Modal
      title={`Диаграммы объекта: ${entity?.name ?? 'Загрузка…'}`}
      onClose={onClose}
      className="object-modal"
    >
      <p className="muted">
        Декомпозиция раскрывает внутреннее устройство в том же ракурсе. Углубление ведёт к
        представлению того же объекта в другом контексте. Расположение в дереве не создаёт этих
        переходов.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!space ? (
        <p className="muted">Загружаем диаграммы…</p>
      ) : (
        <>
          <div className="context-link-list">
            {links.map((link) => {
              const target = space.diagrams.find((d) => d.id === link.targetDiagramId);
              return (
                <article key={link.id} data-context-link={link.id}>
                  <strong>
                    {link.kind === 'decomposition' ? 'Декомпозиция' : 'Углубление / смена ракурса'}
                  </strong>
                  <Link href={contextLinkUrl(link, space)}>
                    {target?.name ?? 'Диаграмма'} · {groupName(target?.viewpointId ?? null)}
                  </Link>
                  <small>
                    {link.meaning || 'Смысл перехода не указан'} ·{' '}
                    {link.sourceDiagramId
                      ? space.diagrams.find((d) => d.id === link.sourceDiagramId)?.name
                      : 'Общий переход объекта'}
                  </small>
                  <div className="button-row">
                    <button
                      className="secondary small"
                      disabled={busy}
                      aria-label={`Изменить смысл перехода ${target?.name}`}
                      onClick={() => setEditingMeaning({ link, value: link.meaning })}
                    >
                      Изменить смысл
                    </button>
                    <button
                      className="secondary small"
                      disabled={busy}
                      aria-label={`Удалить переход ${target?.name}`}
                      onClick={async () => {
                        if (!confirm('Удалить переход? Диаграмма и её элементы сохранятся.'))
                          return;
                        setBusy(true);
                        setError('');
                        try {
                          await api(`context-links/${link.id}`, 'DELETE', {
                            revision: link.revision,
                          });
                          await load();
                          onChanged?.();
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Удалить переход
                    </button>
                  </div>
                </article>
              );
            })}
            {!links.length && <p className="muted">Переходов пока нет.</p>}
          </div>
          {editingMeaning && (
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                try {
                  await api(`context-links/${editingMeaning.link.id}`, 'PATCH', {
                    revision: editingMeaning.link.revision,
                    meaning: editingMeaning.value,
                  });
                  setEditingMeaning(null);
                  await load();
                  onChanged?.();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Смысл перехода
                <input
                  aria-label="Изменить смысл перехода"
                  maxLength={2000}
                  value={editingMeaning.value}
                  onChange={(e) => setEditingMeaning({ ...editingMeaning, value: e.target.value })}
                />
              </label>
              <button disabled={busy} className="primary">
                Сохранить смысл перехода
              </button>
            </form>
          )}
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await api('context-links', 'POST', {
                  entityId,
                  sourceDiagramId: sourceId || null,
                  kind,
                  meaning,
                  ...(mode === 'new'
                    ? { newDiagram: { name: newName, viewpointId: viewpointId || null } }
                    : { targetDiagramId: targetId }),
                });
                setMeaning('');
                setNewName('');
                setTargetId('');
                await load();
                onChanged?.();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h3>Новый переход</h3>
            <label>
              Назначение
              <select
                aria-label="Вид перехода"
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
              >
                <option value="decomposition">Декомпозиция</option>
                <option value="viewpoint">Углубление / смена ракурса</option>
              </select>
            </label>
            {!sourceDiagramId && (
              <label>
                Исходный контекст
                <select
                  aria-label="Исходная диаграмма перехода"
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                >
                  <option value="">Общий переход объекта</option>
                  {space.diagrams.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} · {groupName(d.viewpointId)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {source && (
              <p className="muted small-text">Исходный ракурс: {groupName(source.viewpointId)}</p>
            )}
            <label>
              Диаграмма
              <select
                aria-label="Способ выбора диаграммы"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="existing">Выбрать существующую</option>
                <option value="new" disabled={kind === 'viewpoint' && !newViewAllowed}>
                  Создать новую
                </option>
              </select>
            </label>
            {mode === 'new' ? (
              <>
                <label>
                  Название новой диаграммы
                  <input
                    aria-label="Название новой диаграммы перехода"
                    value={newName}
                    maxLength={100}
                    required
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </label>
                <label>
                  Ракурс
                  <select
                    aria-label="Ракурс новой диаграммы"
                    value={viewpointId}
                    disabled={kind === 'decomposition' && !!source}
                    onChange={(e) => setViewpointId(e.target.value)}
                  >
                    <option value="">Без ракурса</option>
                    {space.viewpoints.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
                {kind === 'viewpoint' && (
                  <p className="muted small-text">
                    В новую диаграмму будет добавлено представление этого же объекта. Отображение
                    можно изменить на канвасе.
                  </p>
                )}
              </>
            ) : (
              <label>
                Целевая диаграмма
                <select
                  aria-label="Целевая диаграмма перехода"
                  required
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                >
                  <option value="">Выберите диаграмму</option>
                  {targets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} · {groupName(d.viewpointId)}
                    </option>
                  ))}
                </select>
                {!targets.length && (
                  <small>
                    Нет подходящих диаграмм. Для углубления на целевой диаграмме должно быть
                    представление этого объекта.
                  </small>
                )}
              </label>
            )}
            <label>
              Смысл перехода
              <input
                aria-label="Смысл перехода"
                maxLength={2000}
                value={meaning}
                onChange={(e) => setMeaning(e.target.value)}
                placeholder={
                  kind === 'decomposition'
                    ? 'Внутреннее устройство процесса'
                    : 'Развёртывание процесса в ЦОД'
                }
              />
            </label>
            <div className="button-row">
              <button className="primary" disabled={busy || entity?.archived}>
                Добавить переход
              </button>
              <button type="button" className="secondary" onClick={() => setViewpointsOpen(true)}>
                Управление ракурсами
              </button>
            </div>
          </form>
        </>
      )}
      {viewpointsOpen && (
        <ViewpointBrowser
          onClose={() => setViewpointsOpen(false)}
          onChanged={() => {
            void load();
            onChanged?.();
          }}
        />
      )}
    </Modal>
  );
}
