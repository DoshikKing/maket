import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { tokenHash, limited } from './auth';
import { reject } from './model-errors';
import { workspaceAccess } from './collaboration-service';
import { mcpGrantsSchema } from './mcp-permissions';
const input = z.object({
  name: z.string().trim().min(1).max(80),
  grants: mcpGrantsSchema,
  expiresAt: z
    .string()
    .datetime()
    .nullable()
    .refine(
      (value) => value === null || Date.parse(value) > Date.now(),
      'Срок действия должен быть в будущем',
    ),
});
const selection = {
  id: true,
  name: true,
  prefix: true,
  grants: true,
  expiresAt: true,
  lastUsedAt: true,
  createdAt: true,
  revision: true,
} as const;
export async function manageMcpKeys(ownerId: string, method: string, id?: string, value?: unknown) {
  if (method === 'GET' && !id)
    return db.mcpKey.findMany({
      where: { ownerId },
      select: selection,
      orderBy: { createdAt: 'desc' },
    });
  if (method === 'DELETE' && id) {
    await db.mcpKey.deleteMany({ where: { id, ownerId } });
    return { ok: true };
  }
  if ((method === 'POST' && !id) || (method === 'PATCH' && id)) {
    const data = input.parse(value);
    for (const grant of data.grants) await workspaceAccess(ownerId, grant.workspaceId);
    if (method === 'PATCH' && id) {
      const { revision } = z.object({ revision: z.number().int().positive() }).parse(value);
      const result = await db.mcpKey.updateMany({
        where: { id, ownerId, revision },
        data: {
          name: data.name,
          grants: data.grants,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          revision: { increment: 1 },
        },
      });
      if (!result.count) reject(409, 'Ключ изменён или удалён. Обновите список');
      return db.mcpKey.findUniqueOrThrow({ where: { id }, select: selection });
    }
    const secret = `maket_mcp_${randomBytes(32).toString('base64url')}`;
    const key = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${ownerId} FOR NO KEY UPDATE`;
      if ((await tx.mcpKey.count({ where: { ownerId } })) >= 50)
        reject(409, 'Можно создать до 50 ключей. Удалите неиспользуемые');
      return tx.mcpKey.create({
        data: {
          ownerId,
          name: data.name,
          grants: data.grants,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          tokenHash: tokenHash(secret),
          prefix: `${secret.slice(0, 18)}…`,
        },
        select: selection,
      });
    });
    return { ...key, secret };
  }
  reject(405, 'Метод не поддерживается');
}
export async function authenticateMcp(request: Request) {
  const match = /^Bearer (maket_mcp_[A-Za-z0-9_-]{43})$/i.exec(
    request.headers.get('authorization') ?? '',
  );
  if (!match) reject(401, 'Требуется MCP-ключ в Authorization: Bearer');
  const key = await db.mcpKey.findUnique({
    where: { tokenHash: tokenHash(match[1]) },
    include: { owner: true },
  });
  if (!key || (key.expiresAt && key.expiresAt <= new Date()) || !key.owner.emailVerified)
    reject(401, 'MCP-ключ недействителен, отозван или истёк');
  if (await limited(`mcp:${key.id}`, 600))
    reject(429, 'Слишком много MCP-запросов. Повторите через 15 минут');
  await db.mcpKey.updateMany({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  return { ...key, grants: mcpGrantsSchema.parse(key.grants) };
}
export type McpIdentity = Awaited<ReturnType<typeof authenticateMcp>>;
