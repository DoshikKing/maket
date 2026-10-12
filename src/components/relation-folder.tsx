'use client';
import { useEffect, type ReactNode } from 'react';
import { useTreeDisclosure } from './use-tree-disclosure';
import { ChevronRight, Folder } from 'lucide-react';

export function RelationFolder({
  entityId,
  name,
  count,
  level,
  revealToken,
  forceOpen = false,
  children,
}: {
  entityId: string;
  name: string;
  count: number;
  level?: number;
  revealToken?: number | string;
  forceOpen?: boolean;
  children?: ReactNode;
}) {
  const { open, setOpen } = useTreeDisclosure(`relations:${entityId}`);
  useEffect(() => {
    if (revealToken !== undefined) setOpen(true);
  }, [revealToken, setOpen]);
  const closed = !open && !forceOpen;
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
        className="relation-folder tree-row"
        aria-label={`Связи объекта ${name}`}
        aria-expanded={!closed}
        title="Системная папка связей владельца. Удаление папки недоступно."
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="tree-toggle" aria-hidden="true">
          <ChevronRight size={14} style={{ transform: closed ? 'none' : 'rotate(90deg)' }} />
        </span>
        <Folder className="tree-icon" size={16} />
        <span className="tree-label">Связи</span> <span className="tree-count">({count})</span>
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
