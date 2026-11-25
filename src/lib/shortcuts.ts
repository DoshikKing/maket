import { z } from 'zod';

// Stable command IDs are shared by menus, keyboard handlers and user settings.
export const commands = {
  open: { label: 'Открыть', key: 'Mod+Enter', edit: false },
  save: { label: 'Сохранить диаграмму', key: 'Mod+KeyS', edit: false },
  undo: { label: 'Отменить', key: 'Mod+KeyZ', edit: true },
  redo: { label: 'Повторить', key: 'Mod+Shift+KeyZ', edit: true },
  mode: { label: 'Режим', key: 'Mod+Shift+KeyM', edit: false },
  fit: { label: 'Вся диаграмма', key: 'Mod+Shift+KeyF', edit: false },
  locate: { label: 'Найти', key: 'Mod+KeyL', edit: false },
  tree: { label: 'В дереве', key: 'Mod+Shift+KeyL', edit: false },
  properties: { label: 'Свойства', key: 'Mod+KeyE', edit: false },
  representation: { label: 'Свойства представления', key: 'Mod+Shift+KeyE', edit: false },
  place: { label: 'Разместить', key: 'Mod+Shift+KeyD', edit: true },
  delete: { label: 'Удалить', key: 'Delete', edit: true },
  front: { label: 'Поверх всех', key: 'Mod+Shift+BracketRight', edit: true },
  back: { label: 'Под всеми', key: 'Mod+Shift+BracketLeft', edit: true },
  forward: { label: 'Слоем выше', key: 'Mod+BracketRight', edit: true },
  backward: { label: 'Слоем ниже', key: 'Mod+BracketLeft', edit: true },
  decomposition: { label: 'Декомпозиция', key: 'Mod+Alt+KeyD', edit: true },
  viewpoint: { label: 'Углубление', key: 'Mod+Alt+KeyV', edit: true },
  children: { label: 'Дочерние элементы', key: 'Mod+Alt+ArrowDown', edit: false },
  createChild: { label: 'Создать внутри', key: 'Mod+Shift+KeyN', edit: true },
  inherit: { label: 'Создать наследника', key: 'Mod+Alt+KeyH', edit: true },
  instantiate: { label: 'Создать реализацию', key: 'Mod+Alt+KeyI', edit: true },
  copy: { label: 'Копировать', key: 'Mod+Alt+KeyC', edit: true },
  archive: { label: 'Архивировать', key: 'Mod+Alt+KeyA', edit: true },
  detachSource: { label: 'Отвязать начало', key: 'Mod+Alt+Digit1', edit: true },
  detachTarget: { label: 'Отвязать конец', key: 'Mod+Alt+Digit2', edit: true },
  panels: { label: 'Все панели', key: 'Mod+Shift+KeyP', edit: false },
} as const;
export type CommandId = keyof typeof commands;
export type Shortcuts = Partial<Record<CommandId, string>>;
const keyCode =
  '(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Delete|Backspace|Enter|Arrow(?:Up|Down|Left|Right)|BracketLeft|BracketRight|Comma|Period|Slash|Backslash|Minus|Equal|Home|End|PageUp|PageDown|Insert)';
const binding = z
  .string()
  .max(80)
  .refine(
    (value) =>
      value === '' || new RegExp(`^(?:Mod\\+)?(?:Alt\\+)?(?:Shift\\+)?${keyCode}$`).test(value),
    'Некорректное сочетание клавиш',
  );
export function commandBinding(id: CommandId, overrides: Shortcuts = {}) {
  return overrides[id] ?? commands[id].key;
}
export function bindingConflict(overrides: Shortcuts) {
  const seen = new Map<string, CommandId>();
  for (const id of Object.keys(commands) as CommandId[]) {
    const key = commandBinding(id, overrides);
    if (!key) continue;
    if (seen.has(key))
      return `Одинаковое сочетание: «${commands[seen.get(key)!].label}» и «${commands[id].label}»`;
    seen.set(key, id);
  }
  return '';
}
export const shortcutsSchema = z
  .partialRecord(z.enum(Object.keys(commands) as [CommandId, ...CommandId[]]), binding)
  .superRefine((value, ctx) => {
    const error = bindingConflict(value);
    if (error) ctx.addIssue({ code: 'custom', message: error });
  });
type KeyEvent = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;
export function eventBinding(event: KeyEvent) {
  if (event.ctrlKey && event.metaKey) return '';
  if (!new RegExp(`^${keyCode}$`).test(event.code)) return '';
  return `${event.ctrlKey || event.metaKey ? 'Mod+' : ''}${event.altKey ? 'Alt+' : ''}${event.shiftKey ? 'Shift+' : ''}${event.code}`;
}
export function shortcutLabel(key: string, mac = false) {
  return key
    .replace('Mod+', mac ? '⌘+' : 'Ctrl+')
    .replace('Alt+', mac ? '⌥+' : 'Alt+')
    .replace(/Key|Digit/g, '')
    .replace('BracketLeft', '[')
    .replace('BracketRight', ']');
}
