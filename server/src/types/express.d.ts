import type { Role } from '../generated/prisma/enums';

// Set by requireAuth (src/middlewares/auth.ts) from a verified access token.
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: Role };
    }
  }
}

export {};
