export const workspaceActions = [
  'read',
  'create',
  'edit',
  'delete',
  'share',
  'members',
  'roles',
  'unlock',
] as const;
export type WorkspaceAction = (typeof workspaceActions)[number];
export const builtinRoles: Record<string, { name: string; actions: WorkspaceAction[] }> = {
  admin: { name: 'Администратор', actions: [...workspaceActions] },
  moderator: {
    name: 'Модератор',
    actions: ['read', 'create', 'edit', 'delete', 'share', 'unlock'],
  },
  editor: { name: 'Редактор', actions: ['read', 'create', 'edit'] },
  viewer: { name: 'Просмотр', actions: ['read'] },
};
export type WorkspaceAccess = {
  userId: string;
  owner: boolean;
  role: string;
  name: string;
  actions: WorkspaceAction[];
  elementIds: string[];
};
export function permitted(access: WorkspaceAccess, action: WorkspaceAction, ids: string[] = []) {
  return (
    access.owner ||
    (access.actions.includes(action) &&
      (action === 'read' ||
        !['create', 'edit', 'delete', 'share'].includes(action) ||
        !access.elementIds.length ||
        ids.every((id) => access.elementIds.includes(id))))
  );
}
// Managing members/roles must never grant authority the actor does not hold.
export function canManageRole(
  access: WorkspaceAccess,
  role: { actions: WorkspaceAction[]; elementIds: string[] },
) {
  return (
    access.owner ||
    (role.actions.every((action) => access.actions.includes(action)) &&
      (!access.elementIds.length ||
        (role.elementIds.length > 0 &&
          role.elementIds.every((id) => access.elementIds.includes(id)))))
  );
}
