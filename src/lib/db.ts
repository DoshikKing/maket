import { databaseConfig } from '../../scripts/database-config.mjs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const { connectionString, schema } = databaseConfig();
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const db =
  globalDb.prisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
if (process.env.NODE_ENV !== 'production') globalDb.prisma = db;
