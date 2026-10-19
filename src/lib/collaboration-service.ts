import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import { db } from './db';
import { currentWorkspace } from './workspace-service';
import { reject } from './model-errors';
import {
  builtinRoles,
  permitted,
  workspaceActions,
  type WorkspaceAccess,
  type WorkspaceAction,
} from './workspace-permissions';

// Separate pool: waiting for the workspace gate must not exhaust the application's pool.
const globalGate = globalThis as unknown as { collaborationGate?: PrismaClient };
const gate =
  globalGate.collaborationGate ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 4 }),
  });
if (process.env.NODE_ENV !== 'production') globalGate.collaborationGate = gate;
export async function workspaceGate<T>(spaceId: string, run: () => Promise<T>): Promise<T> {
  return gate.$transaction(
    async (tx) => {
      // ponytail: serialize writes within each workspace; use per-entity gates if write throughput grows.
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '10s'");
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${spaceId}, 0))::text`;
      return run();
    },
    { timeout: 60000, maxWait: 10000 },
  );
}
export async function workspaceAccess(userId: string, spaceId?: string): Promise<WorkspaceAccess> {
  const space = spaceId
    ? await db.modelSpace.findUnique({ where: { id: spaceId } })
    : await currentWorkspace(userId);
  if (!space) reject(404, 'Рабочая область не найдена');
  if (space.ownerId === userId)
    return {
      userId,
      owner: true,
      role: 'owner',
      name: 'Владелец',
      actions: [...workspaceActions],
      elementIds: [],
    };
  const member = await db.workspaceMember.findUnique({
    where: { spaceId_userId: { spaceId: space.id, userId } },
  });
  if (!member) reject(404, 'Рабочая область не найдена');
  const standard = Object.hasOwn(builtinRoles, member.role) ? builtinRoles[member.role] : undefined;
  const role =
    standard ??
    (await db.workspaceRole.findFirst({ where: { id: member.role, spaceId: space.id } }));
  if (!role) reject(403, 'Роль больше не существует');
  const actions = z.array(z.enum(workspaceActions)).parse(role.actions);
  if (!actions.includes('read')) reject(403, 'Нет доступа к просмотру пространства');
  return {
    userId,
    owner: false,
    role: member.role,
    name: role.name,
    actions,
    elementIds: standard
      ? []
      : z.array(z.string()).parse('elementIds' in role ? role.elementIds : []),
  };
}
export function requirePermission(
  access: WorkspaceAccess,
  action: WorkspaceAction,
  ids: string[] = [],
) {
  if (!permitted(access, action, ids))
    reject(403, 'Ваша роль не разрешает это действие для выбранных элементов');
}
export async function recordWorkspaceEvent(
  spaceId: string,
  user: { id: string; name: string },
  action: string,
  targetId?: string,
) {
  await db.$transaction([
    db.modelSpace.update({
      where: { id: spaceId },
      data: { collaborationRevision: { increment: 1 } },
    }),
    db.workspaceEvent.create({
      data: { spaceId, userId: user.id, userName: user.name, action, targetId },
    }),
  ]);
}
const roleInput = z.object({
  name: z.string().trim().min(1).max(100),
  actions: z
    .array(z.enum(workspaceActions))
    .max(8)
    .refine((a) => a.includes('read'), 'Просмотр обязателен'),
  elementIds: z.array(z.string().min(1).max(100)).max(1000).default([]),
  revision: z.number().int().positive().optional(),
});
const memberInput = z.object({
  email: z
    .string()
    .email()
    .transform((s) => s.toLowerCase()),
  role: z.string().min(1).max(100),
});
export async function lockTargets(spaceId: string, targetId: string): Promise<string[]> {
  const diagram = await db.diagram.findFirst({
    where: { id: targetId, modelSpaceId: spaceId },
    select: {
      entityId: true,
      usages: { select: { objectId: true } },
      relationUsages: { select: { relationId: true } },
    },
  });
  if (diagram)
    return [
      ...new Set([
        targetId,
        ...(diagram.entityId ? [diagram.entityId] : []),
        ...diagram.usages.map((u) => u.objectId),
        ...diagram.relationUsages.map((u) => u.relationId),
      ]),
    ];
  const entity = await db.modelObject.findFirst({
    where: { id: targetId, spaceId },
    select: { diagram: { select: { id: true } } },
  });
  if (entity?.diagram) return lockTargets(spaceId, entity.diagram.id);
  if (!entity && !(await db.modelRelation.findFirst({ where: { id: targetId, spaceId } })))
    reject(404, 'Элемент не найден');
  return [targetId];
}
export async function checkLocks(
  spaceId: string,
  targets: string[],
  userId: string,
  clientId: string | null,
) {
  const locks = await db.workspaceLock.findMany({
    where: { spaceId, targetId: { in: targets }, expiresAt: { gt: new Date() } },
  });
  const conflict = locks.find((l) => l.userId !== userId || l.clientId !== clientId);
  if (conflict) reject(423, `Редактирует ${conflict.userName}. Элемент временно заблокирован`);
}
export async function collaborationRequest(
  spaceId: string,
  user: { id: string; name: string },
  access: WorkspaceAccess,
  parts: string[],
  method: string,
  input: unknown,
  clientId: string | null,
) {
  const [, section, id] = parts;
  if (!section && method === 'GET') {
    const space = await db.modelSpace.findUniqueOrThrow({ where: { id: spaceId } });
    return {
      access,
      revision: space.collaborationRevision,
      locks: await db.workspaceLock.findMany({
        where: { spaceId, expiresAt: { gt: new Date() } },
        select: { targetId: true, userId: true, userName: true, expiresAt: true },
      }),
    };
  }
  if (section === 'events' && method === 'GET')
    return db.workspaceEvent.findMany({
      where: { spaceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  if (section === 'members') {
    requirePermission(access, 'members');
    if (method === 'GET') {
      const space = await db.modelSpace.findUniqueOrThrow({
        where: { id: spaceId },
        select: { owner: { select: { id: true, name: true, email: true } } },
      });
      return {
        owner: space.owner,
        members: await db.workspaceMember.findMany({
          where: { spaceId },
          select: { user: { select: { id: true, name: true, email: true } }, role: true },
        }),
      };
    }
    if (method === 'POST' || method === 'PATCH') {
      const data = memberInput.parse(input);
      if (
        !Object.hasOwn(builtinRoles, data.role) &&
        !(await db.workspaceRole.findFirst({ where: { id: data.role, spaceId } }))
      )
        reject(400, 'Роль не найдена');
      const target = await db.user.findUnique({
        where: { email: data.email },
        select: { id: true, emailVerified: true },
      });
      if (!target?.emailVerified)
        reject(404, 'Зарегистрированный пользователь с подтверждённой почтой не найден');
      const space = await db.modelSpace.findUniqueOrThrow({ where: { id: spaceId } });
      if (target.id === space.ownerId) reject(400, 'Права владельца нельзя изменить');
      await db.workspaceMember.upsert({
        where: { spaceId_userId: { spaceId, userId: target.id } },
        create: { spaceId, userId: target.id, role: data.role },
        update: { role: data.role },
      });
      await db.workspaceLock.deleteMany({ where: { spaceId, userId: target.id } });
      return { ok: true };
    }
    if (method === 'DELETE' && id) {
      await db.workspaceMember.deleteMany({ where: { spaceId, userId: id } });
      await db.workspaceLock.deleteMany({ where: { spaceId, userId: id } });
      return { ok: true };
    }
  }
  if (section === 'roles') {
    // Role definitions contain no member PII and are visible to members.
    if (method === 'GET')
      return db.workspaceRole.findMany({ where: { spaceId }, orderBy: { name: 'asc' } });
    requirePermission(access, 'roles');
    if (method === 'POST' || method === 'PATCH') {
      const data = roleInput.parse(input);
      if (
        data.elementIds.length &&
        data.actions.some((a) => ['members', 'roles', 'unlock'].includes(a))
      )
        reject(400, 'Административные права нельзя ограничить отдельными элементами');
      const known = [
        ...(await db.modelObject.findMany({
          where: { spaceId, id: { in: data.elementIds } },
          select: { id: true },
        })),
        ...(await db.modelRelation.findMany({
          where: { spaceId, id: { in: data.elementIds } },
          select: { id: true },
        })),
        ...(await db.diagram.findMany({
          where: { modelSpaceId: spaceId, id: { in: data.elementIds } },
          select: { id: true },
        })),
      ];
      if (data.elementIds.some((id) => !known.some((o) => o.id === id)))
        reject(400, 'Элемент ограничения не принадлежит пространству');
      if (!id)
        return db.workspaceRole.create({
          data: { spaceId, name: data.name, actions: data.actions, elementIds: data.elementIds },
        });
      if (!data.revision) reject(400, 'Укажите версию роли');
      const result = await db.workspaceRole.updateMany({
        where: { id, spaceId, revision: data.revision },
        data: {
          name: data.name,
          actions: data.actions,
          elementIds: data.elementIds,
          revision: { increment: 1 },
        },
      });
      if (!result.count) reject(409, 'Роль изменена. Обновите данные');
      await db.workspaceLock.deleteMany({
        where: {
          spaceId,
          userId: {
            in: (await db.workspaceMember.findMany({ where: { spaceId, role: id } })).map(
              (m) => m.userId,
            ),
          },
        },
      });
      return { ok: true };
    }
    if (method === 'DELETE' && id) {
      if (await db.workspaceMember.count({ where: { spaceId, role: id } }))
        reject(409, 'Сначала назначьте участникам другую роль');
      await db.workspaceRole.deleteMany({ where: { id, spaceId } });
      return { ok: true };
    }
  }
  if (section === 'locks' && id) {
    const client = z.string().uuid().parse(clientId);
    if (method === 'DELETE') {
      const { force, leaseId } = z
        .object({ force: z.boolean().optional(), leaseId: z.string().uuid().optional() })
        .parse(input ?? {});
      if (force) requirePermission(access, 'unlock');
      await db.workspaceLock.deleteMany({
        where: {
          spaceId,
          ...(force
            ? { targetId: { in: await lockTargets(spaceId, id) } }
            : { rootId: id, userId: user.id, clientId: client, leaseId: leaseId ?? client }),
        },
      });
      return { ok: true };
    }
    if (method === 'POST') {
      await db.workspaceLock.deleteMany({ where: { spaceId, expiresAt: { lte: new Date() } } });
      const data = z
        .object({ renew: z.boolean().optional(), leaseId: z.string().uuid().optional() })
        .parse(input ?? {});
      const { renew } = data;
      const leaseId = data.leaseId ?? client;
      if (
        renew &&
        !(await db.workspaceLock.findFirst({
          where: {
            spaceId,
            rootId: id,
            userId: user.id,
            clientId: client,
            leaseId,
            expiresAt: { gt: new Date() },
          },
        }))
      )
        reject(423, 'Блокировка истекла или снята. Получите доступ заново');
      const targets = await lockTargets(spaceId, id);
      requirePermission(access, 'edit', targets);
      await checkLocks(spaceId, targets, user.id, client);
      const expiresAt = new Date(Date.now() + 45000);
      await db.$transaction(
        targets.map((targetId) =>
          db.workspaceLock.upsert({
            where: { spaceId_targetId_rootId: { spaceId, targetId, rootId: id } },
            create: {
              spaceId,
              targetId,
              rootId: id,
              leaseId,
              userId: user.id,
              userName: user.name,
              clientId: client,
              expiresAt,
            },
            update: { userId: user.id, userName: user.name, clientId: client, leaseId, expiresAt },
          }),
        ),
      );
      return { expiresAt };
    }
  }
  reject(405, 'Метод не поддерживается');
}
