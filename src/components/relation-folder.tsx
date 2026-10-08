'use client';
import { useState, type ReactNode } from 'react';
import { ChevronRight, Folder } from 'lucide-react';

export function RelationFolder({
  entityId,
  name,
  count,
  level,
  children,
}: {
  entityId: string;
  name: string;
  count: number;
  level?: number;
  children?: ReactNode;
}) {
  const [closed, setClosed] = useState(false);
  return (
    <div
      className="system-relation-folder"
      data-folder-id={`relations:${entityId}`}
      data-parent-id={entityId}
      role={level ? 'treeitem' : undefined}
      aria-level={level}
      aria-expanded={!closed}
    >
      <button
        className="relation-folder"
        aria-label={`Связи объекта ${name}`}
        aria-expanded={!closed}
        title="Системная папка связей владельца. Удаление папки недоступно."
        onClick={() => setClosed((prev) => !prev)}
      >
        <ChevronRight size={13} style={{ transform: closed ? 'none' : 'rotate(90deg)' }} />
        <Folder size={14} /> Связи ({count})
      </button>
      {!closed &&
        (count ? (
          <div role={level ? 'group' : undefined} className="hierarchy-children">
            {children}
          </div>
        ) : (
          <p className="muted small-text">Пока нет связей.</p>
        ))}
    </div>
  );
}
