'use client';
import {
  createContext,
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  type ReactNode,
  type KeyboardEvent,
} from 'react';
import {
  commands,
  commandBinding,
  eventBinding,
  type CommandId,
  type Shortcuts,
} from '@/lib/shortcuts';
export const CommandEditingContext = createContext(true);
export function permittedActions(actions: ReactNode, editable: boolean): ReactNode {
  return Children.map(actions, (child) => {
    if (
      !isValidElement<{ children?: ReactNode; disabled?: boolean; 'data-command'?: CommandId }>(
        child,
      )
    )
      return child;
    if (child.type === Fragment)
      return cloneElement(child, {}, permittedActions(child.props.children, editable));
    const command = child.props['data-command'];
    return command && commands[command]?.edit && !editable
      ? cloneElement(child, { disabled: true })
      : child;
  });
}

export function textInput(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
    )
  );
}
/** Dispatch to the same native button/Link as the menu, including its disabled state. */
export function handleCommandKey(event: KeyboardEvent<HTMLElement>, overrides?: Shortcuts) {
  if (event.defaultPrevented || event.nativeEvent.isComposing || textInput(event.target)) return;
  if ((event.target as Element).closest('dialog, [role="menu"]')) return;
  const scope = (event.target as Element).closest('[data-command-scope]');
  const key = eventBinding(event.nativeEvent);
  const id = (Object.keys(commands) as CommandId[]).find(
    (id) => commandBinding(id, overrides) === key && key !== '',
  );
  if (!id) return;
  if (
    scope !== event.currentTarget &&
    !['save', 'undo', 'redo', 'mode', 'fit', 'panels'].includes(id)
  )
    return;
  const button = event.currentTarget.querySelector<HTMLElement>(
    `[data-shortcut-actions] [data-command="${id}"]:not([hidden]):not(:disabled)`,
  );
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) button.click();
}
