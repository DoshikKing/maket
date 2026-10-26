import 'dotenv/config';
import { databaseConfig } from './scripts/database-config.mjs';
import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  experimental: { adapter: true },
  engine: 'js',
  adapter: async () => {
    const { connectionString, schema } = databaseConfig();
    return new PrismaPg({ connectionString }, { schema });
  },
});
