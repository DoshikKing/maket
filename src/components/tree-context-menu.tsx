'use client';

import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { GitBranch } from 'lucide-react';
import { api } from '@/lib/client';
import type { Structure } from '@/lib/structure';
import { contextLinkUrl } from './diagram-links';

type DiagramNavigation = { entityId?: string; beforeNavigate?: () => Promise<boolean> };

/** Keeps the row's existing actions and permissions in a keyboard-accessible menu. */
export function TreeContextMenu({
  actions,
  children,
  entityId,
  beforeNavigate,
  ...props
}: HTMLAttributes<HTMLDivElement> &
  DiagramNavigation & {
    actions: ReactNode;
  }) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  function close(restoreFocus = false) {
    setPosition(null);
    if (restoreFocus) trigger.current?.focus();
  }
  return (
    <div
      {...props}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        trigger.current = event.currentTarget.querySelector<HTMLElement>(
          'button.tree-label, a.tree-label, button:not(.tree-toggle):not(:disabled), a[href]',
        );
        setPosition({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault();
        event.stopPropagation();
        trigger.current = event.target as HTMLElement;
        const bounds = event.currentTarget.getBoundingClientRect();
        setPosition({ x: bounds.left + 20, y: bounds.bottom });
      }}
    >
      {children}
      {position && (
        <ContextMenu
          position={position}
          actions={actions}
          onClose={close}
          entityId={entityId}
          beforeNavigate={beforeNavigate}
        />
      )}
    </div>
  );
}

export function ContextMenu({
  position,
  actions,
  onClose,
  entityId,
  beforeNavigate,
}: DiagramNavigation & {
  position: { x: number; y: number };
  actions: ReactNode;
  onClose: (restoreFocus?: boolean) => void;
}) {
  const router = useRouter();
  const [space, setSpace] = useState<Structure | null>(null),
    [loadError, setLoadError] = useState('');
  useEffect(() => {
    if (!entityId) return;
    let cancelled = false;
    setSpace(null);
    setLoadError('');
    void api<Structure>(
      `context-links?entityId=${encodeURIComponent(entityId)}&include=structure`,
    ).then(
      (result) => {
        if (!cancelled) setSpace(result);
      },
      () => {
        if (!cancelled) setLoadError('Не удалось загрузить переходы к диаграммам.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [entityId]);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef(document.activeElement as HTMLElement | null);
  function close(restoreFocus = false) {
    onClose(restoreFocus);
    if (restoreFocus && menu.current?.contains(document.activeElement)) trigger.current?.focus();
  }
  useLayoutEffect(() => {
    if (!menu.current) return;
    const element = menu.current;
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(position.x, window.innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(position.y, window.innerHeight - bounds.height - 8))}px`;
  }, [position, space, loadError]);
  useLayoutEffect(() => {
    menu.current
      ?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')
      ?.focus({ preventScroll: true });
  }, [position]);
  useEffect(() => {
    const outside = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    const dismiss = () => onClose();
    document.addEventListener('pointerdown', outside);
    document.addEventListener('contextmenu', outside);
    window.addEventListener('resize', dismiss);
    document.addEventListener('wheel', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('contextmenu', outside);
      window.removeEventListener('resize', dismiss);
      document.removeEventListener('wheel', outside);
    };
  }, [position]);
  function items(nodes: ReactNode): ReactNode {
    return Children.map(nodes, (child) => {
      if (!isValidElement<HTMLAttributes<HTMLElement>>(child)) return child;
      if (child.type === Fragment) return cloneElement(child, {}, items(child.props.children));
      if (child.props.hidden) return null;
      const onClick = child.props.onClick;
      return cloneElement(
        child,
        {
          role: 'menuitem',
          tabIndex: -1,
          onClick: (event: MouseEvent<HTMLElement>) => {
            event.stopPropagation();
            close();
            onClick?.(event);
          },
        },
        child.props.children,
        <span>{child.props.title ?? child.props['aria-label']}</span>,
      );
    });
  }
  return (
    position &&
    createPortal(
      <div
        ref={menu}
        className="tree-context-menu"
        role="menu"
        aria-label="Действия элемента"
        style={{ left: position.x, top: position.y }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape' || event.key === 'Tab') {
            event.preventDefault();
            close(true);
            return;
          }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const options = Array.from(
            menu.current!.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'),
          );
          const current = options.indexOf(document.activeElement as HTMLElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? options.length - 1
                : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) %
                  options.length;
          options[next]?.focus();
        }}
      >
        {items(actions)}
        {entityId && !space && (
          <p className="context-menu-note" role="status">
            {loadError || 'Загружаем переходы…'}
          </p>
        )}
        {space &&
          (['decomposition', 'viewpoint'] as const).map((kind) => {
            const links = space.contextLinks.filter(
              (l) =>
                l.entityId === entityId &&
                l.kind === kind &&
                space.diagrams.some((d) => d.id === l.targetDiagramId),
            );
            if (!links.length) return null;
            return (
              <div
                role="group"
                aria-label={
                  kind === 'decomposition' ? 'Переходы к декомпозициям' : 'Переходы по ракурсам'
                }
                key={kind}
                className="context-menu-diagrams"
              >
                <p className="context-menu-note">
                  {kind === 'decomposition' ? 'Декомпозиции' : 'Другие ракурсы'}
                </p>
                {links.map((link) => {
                  const diagram = space.diagrams.find((d) => d.id === link.targetDiagramId)!;
                  const viewpoint =
                    space.viewpoints.find((v) => v.id === diagram.viewpointId)?.name ??
                    'Без ракурса';
                  return (
                    <button
                      key={link.id}
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      aria-label={`${kind === 'decomposition' ? 'Открыть декомпозицию' : 'Перейти к ракурсу'}: ${diagram.name}`}
                      title={link.meaning || diagram.name}
                      onClick={async (event) => {
                        event.stopPropagation();
                        if (beforeNavigate && !(await beforeNavigate())) return;
                        close();
                        router.push(contextLinkUrl(link, space));
                      }}
                    >
                      <GitBranch size={14} />
                      <span>
                        {diagram.name}
                        <small>
                          {viewpoint}
                          {link.meaning ? ` · ${link.meaning}` : ''}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
      </div>,
      document.body,
    )
  );
}
