'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Folder, Layers } from 'lucide-react';
import { api } from '@/lib/client';
import type { Representation } from '@/lib/structure';
export function RepresentationFolder({
  entityId,
  resource = 'objects',
  items,
  localItems,
  currentDiagramId,
  onLocate,
}: {
  entityId: string;
  resource?: 'objects' | 'relations';
  items?: Representation[];
  localItems?: Representation[];
  currentDiagramId?: string;
  onLocate?: (id: string, diagramId: string) => void;
}) {
  const [loaded, setLoaded] = useState<Representation[] | null>(null),
    [error, setError] = useState('');
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
      className="representation-folder"
      onToggle={async (e) => {
        if (!e.currentTarget.open || items || loaded) return;
        try {
          setLoaded(await api<Representation[]>(`${resource}/${entityId}/representations`));
          setError('');
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <summary>
        <Folder size={14} /> Представления {representations ? `(${representations.length})` : ''}
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
      {representations?.map((r) => (
        <Link
          key={`${r.diagramId}:${r.id}`}
          href={`/diagrams/${r.diagramId}?element=${encodeURIComponent(r.id)}`}
          onClick={(e) => {
            if (onLocate) {
              e.preventDefault();
              onLocate(r.id, r.diagramId);
            }
          }}
        >
          <Layers size={13} />
          <span>
            {r.name}
            <small>
              {r.diagramName} · {r.notation} · {r.type}
            </small>
          </span>
        </Link>
      ))}
    </details>
  );
}
