import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: {
    // Not Prisma's env() helper: it throws when .env is missing, which breaks
    // `prisma generate` (postinstall) on a fresh clone and in CI.
    url: process.env.DATABASE_URL ?? '',
  },
});
