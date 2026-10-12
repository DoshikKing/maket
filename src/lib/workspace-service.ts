import type { Prisma } from '@prisma/client';
import { db } from './db';
import { reject } from './model-errors';
import { requestedWorkspaceId } from './workspace-scope';
export async function workspaceInTransaction(tx: Prisma.TransactionClient, ownerId: string) {
  const id = requestedWorkspaceId();
  if (id) {
    const space = await tx.modelSpace.findFirst({ where: { id, ownerId } });
    if (!space) reject(404, 'Рабочая область не найдена');
    return space;
  }
  const existing = await tx.modelSpace.findFirst({
    where: { ownerId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (existing) return existing;
  // The oldest area remains the default for existing API clients and legacy diagrams.
  // Lock the user so first-use requests cannot create two default areas concurrently.
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${ownerId} FOR NO KEY UPDATE`;
  return (
    (await tx.modelSpace.findFirst({
      where: { ownerId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })) ?? tx.modelSpace.create({ data: { ownerId, name: 'Основная рабочая область' } })
  );
}
export async function currentWorkspace(ownerId: string) {
  return db.$transaction((tx) => workspaceInTransaction(tx, ownerId));
}
export async function listWorkspaces(ownerId: string) {
  await currentWorkspace(ownerId);
  return db.modelSpace.findMany({
    where: { ownerId },
    select: { id: true, name: true, revision: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}
