import { expect, it } from 'vitest';
import {
  canManageRole,
  builtinRoles,
  type WorkspaceAccess,
} from '../src/lib/workspace-permissions';
import { hasSafeJsonDepth } from '../src/lib/json-depth';

it('role management cannot grant missing actions, remove scope, or manage a superior role', () => {
  const manager: WorkspaceAccess = {
    userId: 'manager',
    owner: false,
    role: 'custom',
    name: 'Manager',
    actions: ['read', 'members'],
    elementIds: [],
  };
  expect(canManageRole(manager, { actions: builtinRoles.admin.actions, elementIds: [] })).toBe(
    false,
  );
  expect(canManageRole(manager, { actions: ['read'], elementIds: [] })).toBe(true);
  const scoped = {
    ...manager,
    actions: ['read', 'edit'] as WorkspaceAccess['actions'],
    elementIds: ['a'],
  };
  expect(canManageRole(scoped, { actions: ['read', 'edit'], elementIds: [] })).toBe(false);
  expect(canManageRole(scoped, { actions: ['read', 'edit'], elementIds: ['b'] })).toBe(false);
  expect(canManageRole(scoped, { actions: ['read', 'edit'], elementIds: ['a'] })).toBe(true);
  expect(
    canManageRole(
      { ...manager, owner: true },
      { actions: builtinRoles.admin.actions, elementIds: [] },
    ),
  ).toBe(true);
});

it('rejects deeply nested JSON without recursive traversal or restricting scalar properties', () => {
  expect(
    hasSafeJsonDepth({ attributes: { shareToken: 'a custom user property', constructor: 'text' } }),
  ).toBe(true);
  let value: unknown = {};
  for (let i = 0; i < 10000; i++) value = { nested: value };
  expect(hasSafeJsonDepth(value)).toBe(false);
  expect(hasSafeJsonDepth({ nodes: [{ position: { x: 0, y: 0 } }] })).toBe(true);
});
