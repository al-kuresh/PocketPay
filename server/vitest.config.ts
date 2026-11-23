import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      // Separate database: tests truncate every table, so never point this at the dev DB.
      DATABASE_URL: 'postgresql://pocketpay:pocketpay@localhost:5433/pocketpay_test',
      JWT_SECRET: 'test-secret-that-is-at-least-forty-characters-long',
      OTP_DEV_ECHO: 'true',
      KYC_AUTO_APPROVE: 'false',
      STORAGE_DRIVER: 'local',
    },
    globalSetup: ['tests/global-setup.ts'],
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
  },
});
