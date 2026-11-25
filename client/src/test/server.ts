import { setupServer } from 'msw/node'
import type { PublicUser } from '../api/types'

/** One MSW server for every test file; each test adds its own handlers with server.use(). */
export const server = setupServer()

/** The API's error envelope, for MSW handlers. */
export const apiError = (code: string, details?: unknown) => ({
  success: false,
  error: { code, message: `${code} (test)`, details },
})

export const testUser = (overrides: Partial<PublicUser> = {}): PublicUser => ({
  id: '6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
  phone: '01700000000',
  name: 'Test User',
  role: 'CUSTOMER',
  status: 'ACTIVE',
  shopName: null,
  nidMasked: '*******890',
  profilePhotoUrl: null,
  kycStatus: 'APPROVED',
  ...overrides,
})
