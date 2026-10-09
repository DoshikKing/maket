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

/** Keeps the row's existing actions and permissions in a keyboard-accessible menu. */
export function TreeContextMenu({
  actions,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
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
      {position && <ContextMenu position={position} actions={actions} onClose={close} />}
    </div>
  );
}

export function ContextMenu({
  position,
  actions,
  onClose,
}: {
  position: { x: number; y: number };
  actions: ReactNode;
  onClose: (restoreFocus?: boolean) => void;
}) {
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
    element
      .querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')
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
      </div>,
      document.body,
    )
  );
}
