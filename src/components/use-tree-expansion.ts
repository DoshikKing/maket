'use client';
import { useEffect, useRef, useState } from 'react';
import { useUser } from './workspace';
import type { ModelObject } from '@/lib/model';

export function useTreeExpansion(
  entities: ModelObject[],
  focusId?: string | null,
  focusToken?: number,
) {
  const { user } = useUser();
  const key = `maket:tree:${user.id}`;
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const focused = useRef('');
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
      setExpanded(
        new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : []),
      );
    } catch {
      setExpanded(new Set());
    }
  }, [key]);
  useEffect(() => {
    if (!focusId) {
      focused.current = '';
      return;
    }
    const focusKey = `${focusId}:${focusToken ?? ''}`;
    if (
      !expanded ||
      !focusId ||
      !entities.some((o) => o.id === focusId) ||
      focused.current === focusKey
    )
      return;
    focused.current = focusKey;
    const path = new Set<string>();
    let entity = entities.find((o) => o.id === focusId);
    while (entity && !path.has(entity.id)) {
      path.add(entity.id);
      entity = entities.find((o) => o.id === entity?.parentId);
    }
    setExpanded((prev) => new Set([...(prev ?? []), ...path]));
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-model-relation-id="${focusId}"], [data-tree-entity="${focusId}"]`)
        ?.scrollIntoView({ block: 'nearest' }),
    );
  }, [entities, expanded, focusId, focusToken]);
  useEffect(() => {
    if (expanded)
      try {
        localStorage.setItem(key, JSON.stringify([...expanded]));
      } catch {}
  }, [expanded, key]);
  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return { isExpanded: (id: string) => expanded?.has(id) ?? false, toggle };
}
