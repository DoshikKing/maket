'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useUser } from './workspace';

const defaults = { tree: true, palette: true, properties: true, treeWidth: 280 };
export function useWorkspacePanels() {
  const { user } = useUser();
  const key = `maket:panels:${user.id}`;
  const [panels, setPanels] = useState(defaults);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
      setPanels({
        tree: typeof saved?.tree === 'boolean' ? saved.tree : true,
        palette: typeof saved?.palette === 'boolean' ? saved.palette : true,
        properties: typeof saved?.properties === 'boolean' ? saved.properties : true,
        treeWidth:
          typeof saved?.treeWidth === 'number' && Number.isFinite(saved.treeWidth)
            ? Math.max(180, Math.min(720, saved.treeWidth))
            : 280,
      });
    } catch {
      setPanels(defaults);
    }
    setLoadedKey(key);
  }, [key]);
  useEffect(() => {
    if (loadedKey === key) {
      try {
        localStorage.setItem(key, JSON.stringify(panels));
      } catch {
        /* Storage may be unavailable. */
      }
    }
  }, [key, loadedKey, panels]);
  return { panels, setPanels };
}

export function HidePanel({
  label,
  side = 'left',
  onHide,
}: {
  label: string;
  side?: 'left' | 'right';
  onHide: () => void;
}) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={`Скрыть панель «${label}»`}
      title={`Скрыть панель «${label}»`}
      onClick={onHide}
    >
      <Icon size={16} />
    </button>
  );
}

export function PanelEdge({
  side,
  items,
}: {
  side: 'left' | 'right';
  items: { label: string; onShow: () => void }[];
}) {
  if (!items.length) return null;
  const Icon = side === 'left' ? ChevronRight : ChevronLeft;
  return (
    <div
      className={`panel-edge panel-edge-${side}`}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.focus();
      }}
      aria-label={`Скрытые панели ${side === 'left' ? 'слева' : 'справа'}`}
    >
      <div className="panel-edge-peek">
        {items.map(({ label, onShow }) => (
          <div key={label}>
            <strong>{label}</strong>
            <button
              type="button"
              className="secondary small"
              aria-label={`Показать панель «${label}»`}
              onClick={onShow}
            >
              <Icon size={14} /> Раскрыть
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TreeResizeHandle({
  width,
  onResize,
}: {
  width: number;
  onResize: (width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number; max: number } | null>(null);
  function maximum(element: HTMLElement) {
    const container = element.closest('.model-editor-body, .solutions-layout');
    if (!container) return 720;
    const reserved = [
      ...container.querySelectorAll<HTMLElement>(':scope > .palette, :scope > .inspector'),
    ].reduce((sum, panel) => sum + panel.getBoundingClientRect().width, 0);
    const gap = parseFloat(getComputedStyle(container).columnGap) || 0;
    return Math.max(
      180,
      Math.min(
        720,
        container.getBoundingClientRect().width -
          reserved -
          gap -
          (container.classList.contains('solutions-layout') ? 240 : 200),
      ),
    );
  }
  return (
    <div
      className="tree-resize-handle"
      role="separator"
      tabIndex={0}
      aria-label="Ширина дерева объектов"
      title="Перетащите границу или используйте стрелки для изменения ширины дерева"
      aria-orientation="vertical"
      aria-valuemin={180}
      aria-valuemax={720}
      aria-valuenow={Math.round(width)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const element = event.currentTarget;
        drag.current = {
          x: event.clientX,
          width: element.previousElementSibling?.getBoundingClientRect().width ?? width,
          max: maximum(element),
        };
        element.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current)
          onResize(
            Math.max(
              180,
              Math.min(drag.current.max, drag.current.width + event.clientX - drag.current.x),
            ),
          );
      }}
      onPointerUp={(event) => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const max = maximum(event.currentTarget);
        const currentWidth =
          event.currentTarget.previousElementSibling?.getBoundingClientRect().width ?? width;
        onResize(
          event.key === 'Home'
            ? 180
            : event.key === 'End'
              ? max
              : Math.max(
                  180,
                  Math.min(max, currentWidth + (event.key === 'ArrowRight' ? 20 : -20)),
                ),
        );
      }}
    />
  );
}
