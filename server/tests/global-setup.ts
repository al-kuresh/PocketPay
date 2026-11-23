import { execSync } from 'node:child_process';
import type { TestProject } from 'vitest/node';

// Runs once before all test files: bring the test database up to the latest migration.
export default function setup(project: TestProject) {
  const url = project.config.env.DATABASE_URL;
  if (!url?.includes('pocketpay_test')) {
    throw new Error(`Refusing to migrate a non-test database: ${url}`);
  }
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
