import { expect, it } from 'vitest';
import {
  eventBinding,
  shortcutLabel,
  shortcutsSchema,
  bindingConflict,
  commandBinding,
} from '../src/lib/shortcuts';

it('matches physical keys consistently across layouts and Ctrl/Command platforms', () => {
  const event = { code: 'KeyS', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
  expect(eventBinding(event)).toBe('Mod+KeyS');
  expect(eventBinding({ ...event, ctrlKey: false, metaKey: true })).toBe('Mod+KeyS');
  expect(eventBinding({ ...event, shiftKey: true, altKey: true })).toBe('Mod+Alt+Shift+KeyS');
  expect(eventBinding({ ...event, code: 'ShiftLeft' })).toBe('');
  expect(eventBinding({ ...event, ctrlKey: true, metaKey: true })).toBe('');
  expect(shortcutLabel('Mod+Shift+BracketRight', true)).toBe('⌘+Shift+]');
});
it('validates overrides against all effective defaults and permits disabling bindings', () => {
  expect(shortcutsSchema.parse({})).toEqual({});
  expect(bindingConflict({ properties: 'Mod+KeyS' })).toContain('Сохранить');
  expect(shortcutsSchema.safeParse({ properties: 'Mod+KeyS' }).success).toBe(false);
  expect(shortcutsSchema.safeParse({ unknown: 'KeyA' }).success).toBe(false);
  expect(shortcutsSchema.safeParse({ save: 'Ctrl+S' }).success).toBe(false);
  expect(shortcutsSchema.safeParse({ save: 'Mod+KeyQ', properties: 'Mod+KeyS' }).success).toBe(
    true,
  );
  expect(commandBinding('delete', { delete: '' })).toBe('');
  expect(shortcutsSchema.parse({ save: '', properties: '' })).toEqual({ save: '', properties: '' });
});
