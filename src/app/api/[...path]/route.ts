import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { publicDiagram, publicObject } from '@/lib/sharing';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { workspaceScope } from '@/lib/workspace-scope';
import { listWorkspaces, currentWorkspace } from '@/lib/workspace-service';
import {
  workspaceAccess,
  workspaceGate,
  requirePermission,
  collaborationRequest,
  checkLocks,
  lockTargets,
  recordWorkspaceEvent,
} from '@/lib/collaboration-service';
import type { WorkspaceAction } from '@/lib/workspace-permissions';
import {
  checkPassword,
  createSession,
  currentUser,
  hashPassword,
  limited,
  logout,
  sendAuthEmail,
  tokenHash,
} from '@/lib/auth';
import { builtinNotation, notationSchema } from '@/lib/notation';
import { getStructure, deleteDiagram } from '@/lib/structure-service';
import { attributesSchema, entityKindSchema } from '@/lib/model';
import {
  ModelError,
  ensureModel,
  getDiagram,
  listDiagrams,
  newDiagram,
  saveModelDiagram,
  duplicateModelDiagram,
  attachNotation,
  addObject,
  updateObject,
  deleteObject,
  snapshot,
  addRepresentation,
} from '@/lib/model-service';
import {
  addRelation,
  updateRelation,
  deleteRelation,
  relationSnapshot,
} from '@/lib/relation-service';
import {
  viewpointInput,
  contextLinkInput,
  saveViewpoint,
  deleteViewpoint,
  assignViewpoint,
  createContextLink,
  updateContextLink,
} from '@/lib/diagram-context-service';
export const runtime = 'nodejs';
const nameSchema = z.string().trim().min(1).max(100);
const credentials = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(10).max(128),
});
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function fail(status: number, message: string): never {
  throw new ApiError(status, message);
}
async function body(req: Request, required = true) {
  if (Number(req.headers.get('content-length') ?? 0) > 2_000_000)
    fail(413, 'Файл слишком большой (максимум 2 МБ)');
  const reader = req.body?.getReader();
  if (!reader) fail(400, 'Тело запроса обязательно');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 2_000_000) {
      await reader.cancel();
      fail(413, 'Файл слишком большой (максимум 2 МБ)');
    }
    chunks.push(chunk.value);
  }
  if (!size && !required) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    fail(400, 'Невалидный JSON');
  }
}
const asJson = (value: unknown) => value as Prisma.InputJsonValue;
async function handle(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await context.params;
    const [resource, id, action] = path;
    const method = req.method;
    if (method !== 'GET') {
      const expected = new URL(process.env.APP_URL ?? req.url).origin;
      const origin = req.headers.get('origin');
      if (origin && origin !== expected) fail(403, 'Недопустимый источник запроса');
      if (req.headers.get('sec-fetch-site') === 'cross-site')
        fail(403, 'Недопустимый источник запроса');
      if (method !== 'DELETE' && !req.headers.get('content-type')?.startsWith('application/json'))
        fail(415, 'Требуется application/json');
    }
    if (resource === 'auth') {
      if (id === 'me' && method === 'GET') {
        const u = await currentUser();
        return u
          ? json({ id: u.id, email: u.email, name: u.name, settings: u.settings })
          : json({ error: 'Войдите в аккаунт' }, 401);
      }
      if (id === 'logout' && method === 'POST') {
        await logout();
        return json({ ok: true });
      }
      if (id === 'register' && method === 'POST') {
        const input = credentials.extend({ name: nameSchema }).parse(await body(req));
        if (await limited(`register:${input.email}`, 5))
          fail(429, 'Слишком много запросов. Повторите через 15 минут');
        if (process.env.NODE_ENV === 'production' && !process.env.MAIL_WEBHOOK_URL)
          fail(503, 'Сервис почты не настроен');
        const existing = await db.user.findUnique({ where: { email: input.email } });
        if (!existing) {
          const u = await db.user.create({
            data: {
              email: input.email,
              name: input.name,
              passwordHash: await hashPassword(input.password),
            },
          });
          await sendAuthEmail(u.id, u.email, 'verify');
        }
        return json({
          message:
            'Если адрес доступен для регистрации, отправлено письмо с подтверждением. В локальной разработке ссылка находится в консоли сервера.',
        });
      }
      if (id === 'login' && method === 'POST') {
        const input = credentials.parse(await body(req));
        if (await limited(`login:${input.email}`, 15))
          fail(429, 'Слишком много попыток. Повторите через 15 минут');
        const u = await db.user.findUnique({ where: { email: input.email } });
        const valid = await checkPassword(
          input.password,
          u?.passwordHash ?? (await hashPassword('dummy-password-to-check')),
        );
        if (!u || !valid) fail(401, 'Неверная почта или пароль');
        if (!u.emailVerified) fail(403, 'Подтвердите почту перед входом');
        await createSession(u.id);
        return json({ ok: true });
      }
      if ((id === 'recover' || id === 'resend') && method === 'POST') {
        const { email } = credentials.pick({ email: true }).parse(await body(req));
        if (await limited(`${id}:${email}`, 5)) fail(429, 'Слишком много запросов');
        const u = await db.user.findUnique({ where: { email } });
        if (u && (id === 'recover' || !u.emailVerified))
          await sendAuthEmail(u.id, email, id === 'recover' ? 'reset' : 'verify');
        return json({
          message:
            'Если аккаунт существует, письмо отправлено. В локальной разработке ссылка находится в консоли сервера.',
        });
      }
      if ((id === 'verify' || id === 'reset') && method === 'POST') {
        const input = z
          .object({
            token: z.string().regex(/^[a-f0-9]{64}$/),
            password: id === 'reset' ? credentials.shape.password : z.string().optional(),
          })
          .parse(await body(req));
        const token = await db.authToken.findUnique({ where: { id: tokenHash(input.token) } });
        if (!token || token.kind !== id || token.expiresAt < new Date())
          fail(400, 'Ссылка недействительна или истекла');
        const passwordHash = id === 'reset' ? await hashPassword(input.password!) : undefined;
        await db.$transaction(async (tx) => {
          const consumed = await tx.authToken.deleteMany({
            where: { id: token.id, expiresAt: { gt: new Date() } },
          });
          if (consumed.count !== 1) fail(400, 'Ссылка уже использована');
          await tx.user.update({
            where: { id: token.userId },
            data: id === 'verify' ? { emailVerified: true } : { passwordHash },
          });
          if (id === 'reset') {
            await tx.session.deleteMany({ where: { userId: token.userId } });
            await tx.authToken.deleteMany({ where: { userId: token.userId, kind: 'reset' } });
          }
        });
        return json({ ok: true });
      }
      fail(404, 'Неизвестный запрос');
    }
    if (resource === 'public' && id && !action) {
      if (method !== 'GET') fail(405, 'Доступен только просмотр');
      const shared = await publicDiagram(id);
      if (!shared) fail(404, 'Ссылка недоступна или отключена владельцем');
      return json(shared);
    }
    if (resource === 'public-objects' && id && action && path.length === 3) {
      if (method !== 'GET') fail(405, 'Доступен только просмотр');
      const shared = await publicObject(id, action);
      if (!shared) fail(404, 'Ссылка недоступна или отключена владельцем');
      return json(shared);
    }
    const user = await currentUser();
    if (!user) fail(401, 'Войдите в аккаунт');
    if (resource === 'workspaces') {
      if (!id && method === 'GET') return json(await listWorkspaces(user.id));
      if (!id && method === 'POST') {
        const { name } = z.object({ name: nameSchema }).parse(await body(req));
        await listWorkspaces(user.id);
        return json(
          await db.modelSpace.create({
            data: { ownerId: user.id, name },
            select: { id: true, name: true, revision: true },
          }),
          201,
        );
      }
      if (!id) fail(405, 'Укажите рабочую область');
      const area = await db.modelSpace.findFirst({
        where: { id, OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] },
      });
      if (!area) fail(404, 'Рабочая область не найдена');
      if (action === 'open' && method === 'GET') {
        const response = new NextResponse(null, {
          status: 303,
          headers: { Location: '/solutions' },
        });
        response.cookies.set('maket_workspace', area.id, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.APP_URL?.startsWith('https://') ?? false,
          path: '/',
          maxAge: 365 * 86400,
        });
        return response;
      }
      if (!action && method === 'PATCH') {
        const input = z
          .object({ name: nameSchema, revision: z.number().int().positive() })
          .parse(await body(req));
        const result = await db.modelSpace.updateMany({
          where: { id, revision: input.revision },
          data: { name: input.name, revision: { increment: 1 } },
        });
        if (!result.count) fail(409, 'Рабочая область изменена. Обновите список');
        return json(
          await db.modelSpace.findUniqueOrThrow({
            where: { id },
            select: { id: true, name: true, revision: true },
          }),
        );
      }
      fail(405, 'Метод не поддерживается');
    }
    if (resource === 'viewpoints') {
      if (method === 'GET' && !id) {
        const space = await ensureModel(user.id);
        return json(
          req.nextUrl.searchParams.get('include') === 'diagrams'
            ? { viewpoints: space.viewpoints, diagrams: space.diagrams }
            : space.viewpoints,
        );
      }
      if (method === 'POST' && !id)
        return json(await saveViewpoint(user.id, viewpointInput.parse(await body(req))), 201);
      if (!id) fail(405, 'Укажите ракурс');
      if (method === 'PATCH') {
        const input = viewpointInput
          .extend({ revision: z.number().int().positive() })
          .parse(await body(req));
        return json(await saveViewpoint(user.id, viewpointInput.parse(input), id, input.revision));
      }
      if (method === 'DELETE')
        return json(
          await deleteViewpoint(
            user.id,
            id,
            z.object({ revision: z.number().int().positive() }).parse(await body(req)).revision,
          ),
        );
      fail(405, 'Метод не поддерживается');
    }
    if (resource === 'context-links') {
      if (method === 'GET' && !id) {
        const entityId = req.nextUrl.searchParams.get('entityId');
        if (entityId && req.nextUrl.searchParams.get('include') === 'structure')
          return json(
            await getStructure(user.id, z.string().min(1).max(100).parse(entityId), true),
          );
        return json(
          await db.diagramContextLink.findMany({
            where: { spaceId: (await ensureModel(user.id)).id },
          }),
        );
      }
      if (method === 'POST' && !id)
        return json(await createContextLink(user.id, contextLinkInput.parse(await body(req))), 201);
      if (!id) fail(405, 'Укажите переход');
      const input = z
        .object({
          revision: z.number().int().positive(),
          meaning: z.string().trim().max(4000).optional(),
        })
        .parse(await body(req));
      if (method === 'PATCH') {
        if (input.meaning === undefined) fail(400, 'Укажите смысл перехода');
        return json(await updateContextLink(user.id, id, input.revision, input.meaning));
      }
      if (method === 'DELETE') return json(await updateContextLink(user.id, id, input.revision));
      fail(405, 'Метод не поддерживается');
    }
    if (resource === 'settings' && method === 'PATCH') {
      const input = z
        .object({
          name: nameSchema,
          theme: z.enum(['light', 'dark']),
          snapToGrid: z.boolean(),
          autosave: z.boolean(),
        })
        .parse(await body(req));
      const u = await db.user.update({
        where: { id: user.id },
        data: {
          name: input.name,
          settings: { theme: input.theme, snapToGrid: input.snapToGrid, autosave: input.autosave },
        },
      });
      return json({ id: u.id, email: u.email, name: u.name, settings: u.settings });
    }
    if (resource === 'password' && method === 'POST') {
      const input = z
        .object({ currentPassword: z.string().max(128), password: credentials.shape.password })
        .parse(await body(req));
      if (await limited(`password:${user.id}`, 10)) fail(429, 'Слишком много попыток');
      if (!(await checkPassword(input.currentPassword, user.passwordHash)))
        fail(400, 'Текущий пароль неверен');
      await db.$transaction([
        db.user.update({
          where: { id: user.id },
          data: { passwordHash: await hashPassword(input.password) },
        }),
        db.session.deleteMany({ where: { userId: user.id } }),
      ]);
      await createSession(user.id);
      return json({ ok: true });
    }
    if (resource === 'notations') {
      if (method === 'GET' && !id) {
        const list = await db.notation.findMany({
          where: { ownerId: user.id },
          include: { versions: { orderBy: { number: 'desc' }, take: 1 } },
          orderBy: { createdAt: 'desc' },
        });
        return json([
          {
            id: 'builtin',
            name: builtinNotation.name,
            builtin: true,
            versionId: null,
            document: builtinNotation,
          },
          ...list.map((n) => ({
            id: n.id,
            name: n.name,
            builtin: false,
            versionId: n.versions[0].id,
            document: n.versions[0].document,
          })),
        ]);
      }
      if (method === 'POST' && !id) {
        const document = notationSchema.parse(await body(req));
        const n = await db.notation.create({
          data: {
            ownerId: user.id,
            name: document.name,
            versions: { create: { number: 1, document: asJson(document) } },
          },
          include: { versions: true },
        });
        return json(n, 201);
      }
      if (!id) fail(405, 'Укажите идентификатор нотации');
      const n = await db.notation.findFirst({
        where: { id, ownerId: user.id },
        include: { versions: { orderBy: { number: 'desc' }, take: 1 } },
      });
      if (!n) fail(404, 'Нотация не найдена');
      if (method === 'PUT') {
        const document = notationSchema.parse(await body(req));
        const old = notationSchema.parse(n.versions[0].document);
        if (document.id !== old.id) fail(400, 'Идентификатор нотации нельзя менять');
        const a = document.version.split('.').map(Number),
          b = old.version.split('.').map(Number);
        let greater = false;
        for (let i = 0; i < 3; i++) {
          if (a[i] !== b[i]) {
            greater = a[i] > b[i];
            break;
          }
        }
        if (!greater) fail(400, 'Укажите новую, более высокую версию нотации');
        const updated = await db.notation.update({
          where: { id: n.id },
          data: {
            name: document.name,
            versions: { create: { number: n.versions[0].number + 1, document: asJson(document) } },
          },
        });
        return json(updated);
      }
      if (method === 'DELETE') {
        if (
          (await db.diagram.count({ where: { notationVersion: { notationId: n.id } } })) ||
          (await db.diagramNotation.count({ where: { version: { notationId: n.id } } }))
        )
          fail(409, 'Нотация используется диаграммами');
        await db.notation.delete({ where: { id: n.id } });
        return json({ ok: true });
      }
    }
    if (resource === 'model' && method === 'GET')
      return json(
        id === 'layers'
          ? await getStructure(user.id, undefined, false, true)
          : id === 'structure'
            ? await getStructure(user.id)
            : await ensureModel(user.id),
      );
    if (resource === 'relations') {
      const space = await ensureModel(user.id);
      if (method === 'POST' && !id) {
        const input = z
          .object({
            name: nameSchema,
            sourceId: z.string(),
            targetId: z.string(),
            relationType: z.string().trim().max(100).optional(),
            description: z.string().max(4000).optional(),
            attributes: attributesSchema.optional(),
            copyOf: z.string().optional(),
            parentId: z.string().nullable().optional(),
          })
          .parse(await body(req));
        return json(await addRelation(user.id, input), 201);
      }
      if (!id) fail(405, 'Укажите идентификатор связи');
      const relation = await db.modelRelation.findFirst({ where: { id, spaceId: space.id } });
      if (!relation) fail(404, 'Связь не найдена');
      if (method === 'GET' && action === 'representations')
        return json((await getStructure(user.id, id)).representations);
      if (method === 'GET' && action === 'usages')
        return json(
          await db.diagramRelationUsage.findMany({
            where: { relationId: id },
            select: { count: true, diagram: { select: { id: true, name: true } } },
          }),
        );
      if (method === 'GET' && action === 'revisions')
        return json(
          await db.modelRelationRevision.findMany({
            where: { relationId: id },
            select: { number: true, createdAt: true, snapshot: true },
            orderBy: { number: 'desc' },
            take: 100,
          }),
        );
      if (method === 'GET' && !action) return json(relationSnapshot(relation));
      const guard = z.object({
        revision: z.number().int().positive(),
        incarnation: z.string().datetime().optional(),
      });
      if (method === 'DELETE' && !action)
        return json(await deleteRelation(user.id, id, guard.parse(await body(req))));
      if (method === 'PATCH' && !action)
        return json(
          await updateRelation(
            user.id,
            id,
            guard
              .extend({
                name: nameSchema.optional(),
                relationType: z.string().trim().max(100).optional(),
                sourceId: z.string().optional(),
                targetId: z.string().optional(),
                description: z.string().max(4000).optional(),
                attributes: attributesSchema.optional(),
                archived: z.boolean().optional(),
                parentId: z.string().nullable().optional(),
              })
              .parse(await body(req)),
          ),
        );
      if (method === 'POST' && action === 'restore') {
        const input = guard.extend({ number: z.number().int().positive() }).parse(await body(req));
        return json(await updateRelation(user.id, id, input, input.number));
      }
      fail(405, 'Метод не поддерживается');
    }
    if (resource === 'objects') {
      if (method === 'POST' && !id) {
        const input = z
          .object({
            kind: entityKindSchema.optional(),
            name: nameSchema,
            description: z.string().max(4000).optional(),
            parentId: z.string().nullable().optional(),
            attributes: attributesSchema.optional(),
            copyOf: z.string().optional(),
            baseId: z.string().optional(),
            derivation: z.enum(['inheritance', 'instance']).optional(),
          })
          .parse(await body(req));
        return json(await addObject(user.id, input), 201);
      }
      if (!id) fail(405, 'Укажите идентификатор объекта');
      const space = await ensureModel(user.id);
      const object = await db.modelObject.findFirst({ where: { id, spaceId: space.id } });
      if (!object) fail(404, 'Объект не найден');
      if (action === 'share') {
        const sharing = (value: typeof object) => ({
          enabled: value.shareEnabled,
          path: value.shareToken ? `/view/object/${value.id}/${value.shareToken}` : null,
        });
        if (method === 'GET') return json(sharing(object));
        if (method === 'POST') {
          const input = z
            .object({ enabled: z.boolean(), rotate: z.boolean().optional() })
            .parse(await body(req));
          if (input.enabled && !object.shareToken && !input.rotate)
            await db.modelObject.updateMany({
              where: { id, spaceId: space.id, shareToken: null },
              data: { shareToken: randomBytes(32).toString('base64url') },
            });
          const updated = await db.modelObject.update({
            where: { id, spaceId: space.id },
            data: {
              shareEnabled: input.enabled,
              ...(input.rotate ? { shareToken: randomBytes(32).toString('base64url') } : {}),
            },
          });
          return json(sharing(updated));
        }
        fail(405, 'Метод не поддерживается');
      }
      if (method === 'GET' && action === 'representations')
        return json((await getStructure(user.id, id)).representations);
      if (method === 'GET' && action === 'usages')
        return json(
          await db.diagramObjectUsage.findMany({
            where: { objectId: id },
            select: { count: true, diagram: { select: { id: true, name: true } } },
          }),
        );
      if (method === 'GET' && action === 'revisions')
        return json(
          await db.modelObjectRevision.findMany({
            where: { objectId: id },
            select: { number: true, createdAt: true, snapshot: true },
            orderBy: { number: 'desc' },
            take: 100,
          }),
        );
      if (method === 'DELETE' && !action) {
        const { revision, incarnation } = z
          .object({
            revision: z.number().int().positive(),
            incarnation: z.string().datetime().optional(),
          })
          .parse(await body(req));
        return json(await deleteObject(user.id, id, revision, incarnation));
      }
      if (method === 'GET')
        return json(space.objects.find((o) => o.id === object.id) ?? snapshot(object));
      if (method === 'PATCH') {
        const input = z
          .object({
            revision: z.number().int().positive(),
            incarnation: z.string().datetime().optional(),
            name: nameSchema.optional(),
            description: z.string().max(4000).optional(),
            parentId: z.string().nullable().optional(),
            attributes: attributesSchema.optional(),
            archived: z.boolean().optional(),
          })
          .parse(await body(req));
        return json(await updateObject(user.id, id, input));
      }
      if (method === 'POST' && action === 'restore') {
        const input = z
          .object({
            revision: z.number().int().positive(),
            number: z.number().int().positive(),
            incarnation: z.string().datetime().optional(),
          })
          .parse(await body(req));
        return json(
          await updateObject(
            user.id,
            id,
            { revision: input.revision, incarnation: input.incarnation },
            input.number,
          ),
        );
      }
    }
    if (resource === 'diagrams') {
      if (method === 'GET' && !id) return json(await listDiagrams(user.id));
      if (method === 'POST' && !id) {
        const input = z
          .object({
            parentId: z.string().nullable().optional(),
            viewpointId: z.string().nullable().optional(),
            name: nameSchema,
            notationId: z.string().optional(),
            notationIds: z.array(z.string()).min(1).max(12).optional(),
            document: z.unknown().optional(),
          })
          .parse(await body(req));
        return json(
          await newDiagram(user.id, {
            ...input,
            notationIds: input.notationIds ?? (input.notationId ? [input.notationId] : undefined),
          }),
          201,
        );
      }
      if (!id) fail(405, 'Укажите идентификатор диаграммы');
      const area = await ensureModel(user.id);
      const d = await db.diagram.findFirst({
        where: { id, modelSpaceId: area.id },
      });
      if (!d) fail(404, 'Диаграмма не найдена');
      if (action === 'viewpoint' && method === 'PATCH') {
        const input = z
          .object({
            viewpointId: z.string().min(1).max(100).nullable(),
            revision: z.number().int().positive(),
          })
          .parse(await body(req));
        return json(await assignViewpoint(user.id, id, input.viewpointId, input.revision));
      }
      if (action === 'share') {
        if (method === 'GET')
          return json({
            enabled: d.shareEnabled,
            path: d.shareToken ? `/view/${d.shareToken}` : null,
          });
        if (method === 'POST') {
          const input = z
            .object({ enabled: z.boolean(), rotate: z.boolean().optional() })
            .parse(await body(req));
          // Initialize once without replacing a link created concurrently in another tab.
          if (input.enabled && !d.shareToken && !input.rotate) {
            await db.diagram.updateMany({
              where: { id, modelSpaceId: area.id, shareToken: null },
              data: { shareToken: randomBytes(32).toString('base64url') },
            });
          }
          const updated = await db.diagram.update({
            where: { id, modelSpaceId: area.id },
            data: {
              shareEnabled: input.enabled,
              ...(input.rotate ? { shareToken: randomBytes(32).toString('base64url') } : {}),
            },
          });
          return json({
            enabled: updated.shareEnabled,
            path: updated.shareToken ? `/view/${updated.shareToken}` : null,
          });
        }
        fail(405, 'Метод не поддерживается');
      }
      if (method === 'GET' && action === 'revisions') {
        await ensureModel(user.id);
        return json(
          await db.diagramRevision.findMany({
            where: { diagramId: id },
            select: { number: true, createdAt: true, reason: true },
            orderBy: { number: 'desc' },
            take: 100,
          }),
        );
      }
      if (method === 'GET' && action === 'history') {
        const number = z.coerce
          .number()
          .int()
          .positive()
          .parse(req.nextUrl.searchParams.get('number'));
        return json(await getDiagram(user.id, id, number));
      }
      if (method === 'GET') return json(await getDiagram(user.id, id));
      if (method === 'DELETE') {
        return json(await deleteDiagram(user.id, id));
      }
      if (method === 'PATCH') {
        const { name } = z.object({ name: nameSchema }).parse(await body(req));
        await ensureModel(user.id);
        const current = await db.diagram.findUniqueOrThrow({ where: { id } });
        if (current.entityId) {
          const entity = await db.modelObject.findUniqueOrThrow({
            where: { id: current.entityId },
          });
          await updateObject(user.id, entity.id, { revision: entity.revision, name });
        }
        return json(await db.diagram.findUniqueOrThrow({ where: { id } }));
      }
      if (method === 'POST' && action === 'duplicate')
        return json(await duplicateModelDiagram(user.id, id), 201);
      if (method === 'POST' && action === 'notations') {
        const input = z
          .object({
            revision: z.number().int().positive(),
            notationId: z.string().optional(),
            removeBindingId: z.string().optional(),
          })
          .refine((v) => !!v.notationId !== !!v.removeBindingId, 'Укажите одну операцию с нотацией')
          .parse(await body(req));
        return json(
          await attachNotation(
            user.id,
            id,
            input.revision,
            input.notationId,
            input.removeBindingId,
          ),
        );
      }
      if (method === 'POST' && action === 'representations') {
        const input = z
          .object({
            revision: z.number().int().positive(),
            bindingId: z.string(),
            typeId: z.string(),
            objectId: z.string().optional(),
            properties: attributesSchema.optional(),
            position: z.object({ x: z.number().finite(), y: z.number().finite() }),
          })
          .parse(await body(req));
        return json(await addRepresentation(user.id, id, input.revision, input), 201);
      }
      if ((method === 'PUT' && !action) || (method === 'POST' && action === 'restore')) {
        const input = z
          .object({
            revision: z.number().int().positive(),
            document: z.unknown().optional(),
            number: z.number().int().positive().optional(),
          })
          .parse(await body(req));
        if (action === 'restore' && !input.number) fail(400, 'Укажите номер ревизии');
        return json(
          await saveModelDiagram(
            user.id,
            id,
            input.revision,
            input.document,
            action === 'restore' ? input.number : undefined,
          ),
        );
      }
    }
    fail(404, 'Неизвестный запрос');
  } catch (error) {
    if (error instanceof ApiError || error instanceof ModelError)
      return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return json(
        { error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
        400,
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2002', 'P2003'].includes(error.code)
    )
      return json({ error: 'Конфликт данных. Обновите страницу и повторите действие' }, 409);
    console.error('[maket API]', error);
    return json(
      { error: 'Не удалось выполнить операцию. Проверьте сервер и подключение к базе данных' },
      500,
    );
  }
}
const workspaceResources = new Set([
  'collaboration',
  'model',
  'objects',
  'relations',
  'diagrams',
  'viewpoints',
  'context-links',
]);
async function scopedHandle(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return workspaceScope.run(req.headers.get('x-maket-workspace') || undefined, async () => {
    const { path } = await context.params;
    const [resource, id, action] = path;
    if (!workspaceResources.has(resource) && !(resource === 'workspaces' && id))
      return handle(req, context);
    try {
      const user = await currentUser();
      if (!user) return json({ error: 'Войдите в аккаунт' }, 401);
      const spaceId = resource === 'workspaces' ? id : (await currentWorkspace(user.id)).id;
      const write = req.method !== 'GET';
      if (write) {
        const origin = req.headers.get('origin');
        if (
          (origin && origin !== new URL(process.env.APP_URL ?? req.url).origin) ||
          req.headers.get('sec-fetch-site') === 'cross-site'
        )
          fail(403, 'Недопустимый источник запроса');
        if (
          req.method !== 'DELETE' &&
          !req.headers.get('content-type')?.startsWith('application/json')
        )
          fail(415, 'Требуется application/json');
      }
      const input =
        write && req.body ? await body(req.clone(), req.method !== 'DELETE') : undefined;
      const run = async () => {
        const access = await workspaceAccess(user.id, spaceId);
        if (resource === 'collaboration') {
          const result = await collaborationRequest(
            spaceId,
            user,
            access,
            path,
            req.method,
            input,
            req.headers.get('x-maket-client'),
          );
          if (write && id !== 'locks')
            await recordWorkspaceEvent(spaceId, user, `${req.method} collaboration/${id}`, action);
          return json(result);
        }
        if (write) {
          const permission: WorkspaceAction =
            resource === 'workspaces'
              ? 'members'
              : action === 'share'
                ? 'share'
                : req.method === 'DELETE'
                  ? 'delete'
                  : !id || action === 'duplicate'
                    ? 'create'
                    : 'edit';
          const targets = new Set<string>();
          if (id && ['objects', 'relations', 'diagrams'].includes(resource))
            for (const target of await lockTargets(spaceId, id)) targets.add(target);
          if (id && ['context-links', 'relations'].includes(resource)) {
            const link = await db.diagramContextLink.findFirst({ where: { id, spaceId } });
            if (link) {
              targets.add(link.entityId);
              targets.add(link.targetDiagramId);
              if (link.sourceDiagramId) targets.add(link.sourceDiagramId);
            }
          }
          const collect = (value: unknown) => {
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value)) {
              value.forEach(collect);
              return;
            }
            for (const [key, v] of Object.entries(value)) {
              if (
                [
                  'objectId',
                  'relationId',
                  'entityId',
                  'sourceId',
                  'targetId',
                  'parentId',
                  'sourceDiagramId',
                  'targetDiagramId',
                  'baseId',
                  'copyOf',
                ].includes(key) &&
                typeof v === 'string' &&
                v
              )
                targets.add(v);
              if (
                key !== 'bindings' &&
                key !== 'notation' &&
                key !== 'attributes' &&
                key !== 'properties'
              )
                collect(v);
            }
          };
          let restoredDocument: unknown;
          if (resource === 'diagrams' && id && action === 'restore') {
            const number = z.object({ number: z.number().int().positive() }).parse(input).number;
            restoredDocument = (
              await db.diagramRevision.findFirst({
                where: { diagramId: id, number, diagram: { modelSpaceId: spaceId } },
                select: { document: true },
              })
            )?.document;
            collect(restoredDocument);
          }
          collect(input);
          if (
            access.elementIds.length &&
            (resource === 'viewpoints' || (permission === 'create' && !targets.size))
          )
            fail(403, 'Действие требует доступа ко всему пространству');
          if (resource === 'diagrams' && id && permission === 'edit') {
            const value = (restoredDocument ? { document: restoredDocument } : input) as
              | {
                  objectId?: string;
                  document?: {
                    schemaVersion?: number;
                    nodes?: { objectId?: string }[];
                    edges?: { relationId?: string }[];
                  };
                }
              | undefined;
            if (action === 'representations' && !value?.objectId)
              requirePermission(access, 'create', [...targets]);
            if (((!action && req.method === 'PUT') || action === 'restore') && value?.document) {
              if ('schemaVersion' in value.document && value.document.schemaVersion === 1)
                requirePermission(access, 'create', [...targets]);
              const objectIds = (value.document.nodes ?? []).flatMap((n) =>
                n.objectId ? [n.objectId] : [],
              );
              const relationIds = (value.document.edges ?? []).flatMap((e) =>
                e.relationId ? [e.relationId] : [],
              );
              const [objects, relations] = await Promise.all([
                db.modelObject.count({ where: { spaceId, id: { in: [...new Set(objectIds)] } } }),
                db.modelRelation.count({
                  where: { spaceId, id: { in: [...new Set(relationIds)] } },
                }),
              ]);
              if (
                objects !== new Set(objectIds).size ||
                relations !== new Set(relationIds).size ||
                value.document.edges?.some((e) => !e.relationId)
              )
                requirePermission(access, 'create', [...targets]);
            }
          }
          requirePermission(access, permission, [...targets]);
          const claims = req.headers.get('x-maket-leases');
          if (claims && permission !== 'share') {
            let parsed: unknown;
            try {
              parsed = JSON.parse(claims);
            } catch {
              fail(400, 'Некорректная блокировка');
            }
            const roots = z
              .array(z.object({ rootId: z.string().min(1).max(100), leaseId: z.string().uuid() }))
              .max(20)
              .parse(parsed);
            const leases = await db.workspaceLock.findMany({
              where: {
                spaceId,
                rootId: { in: roots.map((r) => r.rootId) },
                userId: user.id,
                clientId: req.headers.get('x-maket-client') ?? '',
                expiresAt: { gt: new Date() },
              },
              select: { rootId: true, leaseId: true },
            });
            if (
              roots.some(
                (root) =>
                  !leases.some((l) => l.rootId === root.rootId && l.leaseId === root.leaseId),
              )
            )
              fail(423, 'Блокировка истекла или снята. Получите доступ заново');
          }
          if (permission !== 'share')
            await checkLocks(spaceId, [...targets], user.id, req.headers.get('x-maket-client'));
        }
        const result = await handle(req, context);
        if (write && result.ok)
          await recordWorkspaceEvent(
            spaceId,
            user,
            `${req.method} ${resource}${action ? `/${action}` : ''}`,
            id,
          );
        return result;
      };
      return write ? await workspaceGate(spaceId, run) : await run();
    } catch (error) {
      if (error instanceof ApiError || error instanceof ModelError)
        return json({ error: error.message }, error.status);
      if (error instanceof z.ZodError)
        return json({ error: error.issues.map((i) => i.message).join('; ') }, 400);
      console.error('[collaboration API]', error);
      return json({ error: 'Не удалось выполнить операцию совместной работы' }, 500);
    }
  });
}

export {
  scopedHandle as GET,
  scopedHandle as POST,
  scopedHandle as PUT,
  scopedHandle as PATCH,
  scopedHandle as DELETE,
};
