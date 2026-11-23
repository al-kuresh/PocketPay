import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    CLIENT_ORIGIN: z.url().default('http://localhost:5173'),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
    // stringbool: env vars are strings, so "false" must become false (not truthy).
    OTP_DEV_ECHO: z.stringbool().default(true),
    KYC_AUTO_APPROVE: z.stringbool().default(false),
    STORAGE_DRIVER: z.enum(['local', 'cloudinary']).default('local'),
    CLOUDINARY_URL: z
      .string()
      .startsWith('cloudinary://', 'must start with cloudinary://')
      .optional(),
  })
  .superRefine((e, ctx) => {
    if (e.STORAGE_DRIVER === 'cloudinary' && !e.CLOUDINARY_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['CLOUDINARY_URL'],
        message: 'is required when STORAGE_DRIVER=cloudinary',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Name every bad key so a misconfigured deploy fails with a readable message.
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment variables — ${problems}`);
  }
  return result.data;
}

export const env = parseEnv(process.env);
