import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
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
import { builtinNotation, diagramErrors, diagramSchema, notationSchema } from '@/lib/notation';
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
async function body(req: NextRequest) {
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
    const user = await currentUser();
    if (!user) fail(401, 'Войдите в аккаунт');
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
        if (await db.diagram.count({ where: { notationVersion: { notationId: n.id } } }))
          fail(409, 'Нотация используется диаграммами');
        await db.notation.delete({ where: { id: n.id } });
        return json({ ok: true });
      }
    }
    if (resource === 'diagrams') {
      if (method === 'GET' && !id)
        return json(
          await db.diagram.findMany({
            where: { ownerId: user.id },
            select: {
              id: true,
              name: true,
              revision: true,
              createdAt: true,
              updatedAt: true,
              document: true,
            },
            orderBy: { updatedAt: 'desc' },
          }),
        );
      if (method === 'POST' && !id) {
        const input = z
          .object({
            name: nameSchema,
            notationId: z.string().optional(),
            document: diagramSchema.optional(),
          })
          .parse(await body(req));
        let document = input.document,
          notationVersionId: string | null = null;
        if (!document) {
          const n =
            input.notationId && input.notationId !== 'builtin'
              ? await db.notation.findFirst({
                  where: { id: input.notationId, ownerId: user.id },
                  include: { versions: { orderBy: { number: 'desc' }, take: 1 } },
                })
              : null;
          if (input.notationId && input.notationId !== 'builtin' && !n)
            fail(404, 'Нотация не найдена');
          notationVersionId = n?.versions[0].id ?? null;
          document = {
            schemaVersion: 1,
            notation: n ? notationSchema.parse(n.versions[0].document) : builtinNotation,
            nodes: [],
            edges: [],
          };
        }
        const errors = diagramErrors(document);
        if (errors.length) fail(400, errors.join('; '));
        const d = await db.diagram.create({
          data: {
            ownerId: user.id,
            name: input.name,
            notationVersionId,
            document: asJson(document),
            revisions: { create: { number: 1, document: asJson(document), reason: 'create' } },
          },
        });
        return json(d, 201);
      }
      if (!id) fail(405, 'Укажите идентификатор диаграммы');
      const d = await db.diagram.findFirst({ where: { id, ownerId: user.id } });
      if (!d) fail(404, 'Диаграмма не найдена');
      if (method === 'GET' && action === 'revisions')
        return json(
          await db.diagramRevision.findMany({
            where: { diagramId: d.id },
            select: { number: true, createdAt: true, reason: true },
            orderBy: { number: 'desc' },
            take: 100,
          }),
        );
      if (method === 'GET') return json(d);
      if (method === 'DELETE') {
        await db.diagram.delete({ where: { id: d.id } });
        return json({ ok: true });
      }
      if (method === 'PATCH') {
        const { name } = z.object({ name: nameSchema }).parse(await body(req));
        return json(await db.diagram.update({ where: { id: d.id }, data: { name } }));
      }
      if (method === 'POST' && action === 'duplicate')
        return json(
          await db.diagram.create({
            data: {
              ownerId: user.id,
              name: `${d.name.slice(0, 90)} — копия`,
              notationVersionId: d.notationVersionId,
              document: asJson(d.document),
              revisions: {
                create: { number: 1, document: asJson(d.document), reason: 'duplicate' },
              },
            },
          }),
          201,
        );
      if ((method === 'PUT' && !action) || (method === 'POST' && action === 'restore')) {
        const input = z
          .object({
            revision: z.number().int().positive(),
            document: diagramSchema.optional(),
            number: z.number().int().positive().optional(),
          })
          .parse(await body(req));
        let document = input.document;
        if (action === 'restore') {
          const old = await db.diagramRevision.findUnique({
            where: { diagramId_number: { diagramId: d.id, number: input.number ?? 0 } },
          });
          if (!old) fail(404, 'Версия не найдена');
          document = diagramSchema.parse(old.document);
        }
        if (!document) fail(400, 'Документ обязателен');
        if (
          JSON.stringify(document.notation) !==
          JSON.stringify(diagramSchema.parse(d.document).notation)
        )
          fail(400, 'Нотацию существующей диаграммы нельзя заменить');
        const errors = diagramErrors(document);
        if (errors.length) fail(400, errors.join('; '));
        const result = await db.$transaction(async (tx) => {
          const changed = await tx.diagram.updateMany({
            where: { id: d.id, ownerId: user.id, revision: input.revision },
            data: { document: asJson(document), revision: { increment: 1 } },
          });
          if (changed.count !== 1)
            fail(
              409,
              'Диаграмма изменена в другой вкладке. Сохраните файл и перезагрузите страницу',
            );
          await tx.diagramRevision.create({
            data: {
              diagramId: d.id,
              number: input.revision + 1,
              document: asJson(document),
              reason: action === 'restore' ? 'restore' : 'save',
            },
          });
          return tx.diagram.findUniqueOrThrow({ where: { id: d.id } });
        });
        return json(result);
      }
    }
    fail(404, 'Неизвестный запрос');
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
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
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
