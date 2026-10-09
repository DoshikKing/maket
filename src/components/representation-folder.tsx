'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Folder, Layers } from 'lucide-react';
import { api } from '@/lib/client';
import type { Representation } from '@/lib/structure';
import { useTreeDisclosure } from './use-tree-disclosure';
export function RepresentationFolder({
  entityId,
  resource = 'objects',
  items,
  localItems,
  currentDiagramId,
  onLocate,
  level,
}: {
  entityId: string;
  resource?: 'objects' | 'relations';
  items?: Representation[];
  localItems?: Representation[];
  currentDiagramId?: string;
  onLocate?: (id: string, diagramId: string) => void;
  level?: number;
}) {
  const [loaded, setLoaded] = useState<Representation[] | null>(null),
    [error, setError] = useState('');
  const { open, setOpen } = useTreeDisclosure(`representations:${entityId}`);
  const representations =
    items?.filter((r) => r.entityId === entityId) ??
    (loaded
      ? [
          ...loaded.filter((r) => r.diagramId !== currentDiagramId),
          ...(localItems ?? []).filter((r) => r.entityId === entityId),
        ]
      : null);
  return (
    <details
      open={open}
      className="representation-folder"
      data-parent-id={entityId}
      data-folder-id={`representations:${entityId}`}
      role={level ? 'treeitem' : undefined}
      aria-level={level}
      aria-expanded={level ? open : undefined}
      onToggle={async (e) => {
        setOpen(e.currentTarget.open);
        if (!e.currentTarget.open || items || loaded) return;
        try {
          setLoaded(await api<Representation[]>(`${resource}/${entityId}/representations`));
          setError('');
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <summary
        className="tree-row"
        title="Системная папка представлений владельца. Удаление папки недоступно."
      >
        <span className="tree-toggle" aria-hidden="true">
          <ChevronRight size={14} style={{ transform: open ? 'rotate(90deg)' : 'none' }} />
        </span>
        <Folder className="tree-icon" size={16} />
        <span className="tree-label">Представления</span>{' '}
        {representations && <span className="tree-count">({representations.length})</span>}
      </summary>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!representations && !error && <p className="muted">Загружаем…</p>}
      {representations?.length === 0 && (
        <p className="muted small-text">Пока нет представлений на диаграммах.</p>
      )}
      <div className="hierarchy-children" role={level ? 'group' : undefined}>
        {representations?.map((r) => (
          <div
            className="representation-entry"
            key={`${r.diagramId}:${r.id}`}
            role={level ? 'treeitem' : undefined}
            aria-level={level ? level + 1 : undefined}
          >
            <Link
              className="tree-row tree-row-leaf"
              href={`/solutions?diagram=${r.diagramId}&element=${encodeURIComponent(r.id)}`}
              onClick={(e) => {
                if (onLocate) {
                  e.preventDefault();
                  onLocate(r.id, r.diagramId);
                }
              }}
            >
              <Layers className="tree-icon" size={16} />
              <span className="tree-label">
                {r.name}
                <small>
                  {r.diagramName} · {r.notation} · {r.type}
                </small>
              </span>
            </Link>
          </div>
        ))}
      </div>
    </details>
  );
}
