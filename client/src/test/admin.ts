// Fake admin API data for the admin page tests. Demo people only (the seed's Jamal Uddin and Nusrat Jahan).
import type { AdminUser, AdminUserDetail, AuditItem, KycDetail, KycListItem } from '../api/admin'
import { testUser } from './server'

export const JAMAL_ID = '2b0d6c1e-5f4a-4b3c-9d8e-7f6a5b4c3d2e'
export const SUBMISSION_ID = '7c9e1f2a-3b4d-4e5f-8a9b-1c2d3e4f5a6b'

/** Sign in as the demo admin. */
export const adminUser = () => testUser({ role: 'ADMIN', name: 'Demo Admin', phone: '01800000001', nidMasked: '*******001' })

export const kycItem = (overrides: Partial<KycListItem> = {}): KycListItem => ({
  id: SUBMISSION_ID,
  submittedAt: '2026-11-26T04:00:00.000Z',
  status: 'PENDING',
  user: { id: JAMAL_ID, name: 'Jamal Uddin', phone: '01800000006', role: 'AGENT', shopName: 'Jamal Store', nidMasked: '*******006' },
  ...overrides,
})

/** `n` changes the signed links, as a refetch does. */
export const kycDetail = (overrides: Partial<KycDetail> = {}, n = 1): KycDetail => ({
  id: SUBMISSION_ID,
  status: 'PENDING',
  submittedAt: '2026-11-26T04:00:00.000Z',
  reviewedAt: null,
  reason: null,
  reviewedBy: null,
  isLatest: true,
  user: {
    id: JAMAL_ID,
    name: 'Jamal Uddin',
    phone: '01800000006',
    role: 'AGENT',
    shopName: 'Jamal Store',
    dateOfBirth: '1990-01-15',
    nidNumber: '9000000006',
    status: 'PENDING_KYC',
  },
  images: {
    nidFront: `/api/v1/files/private/kyc/front.webp?exp=${n}&sig=fake-front-${n}`,
    nidBack: `/api/v1/files/private/kyc/back.webp?exp=${n}&sig=fake-back-${n}`,
    selfie: `/api/v1/files/private/kyc/selfie.webp?exp=${n}&sig=fake-selfie-${n}`,
  },
  history: [],
  ...overrides,
})

export const userRow = (overrides: Partial<AdminUser> = {}): AdminUser => ({
  id: JAMAL_ID,
  name: 'Jamal Uddin',
  phone: '01800000006',
  role: 'AGENT',
  status: 'ACTIVE',
  shopName: 'Jamal Store',
  nidMasked: '*******006',
  kycStatus: 'APPROVED',
  lockedUntil: null,
  createdAt: '2026-11-20T06:00:00.000Z',
  ...overrides,
})

export const auditItem = (overrides: Partial<AuditItem> = {}): AuditItem => ({
  id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  createdAt: '2026-11-26T05:00:00.000Z',
  action: 'USER_FROZEN',
  actor: { id: '1f2e3d4c-5b6a-4978-8a6b-5c4d3e2f1a0b', name: 'Demo Admin', role: 'ADMIN' },
  targetType: 'user',
  targetId: JAMAL_ID,
  metadata: { userId: JAMAL_ID, reason: 'Suspicious activity reported' },
  ip: '127.0.0.1',
  ...overrides,
})

export const userDetail = (overrides: Partial<AdminUserDetail> = {}): AdminUserDetail => ({
  ...userRow(),
  failedPinAttempts: 0,
  balance: '1234550',
  latestKyc: { id: SUBMISSION_ID, status: 'APPROVED' },
  recentAudit: [auditItem({ action: 'KYC_APPROVED', metadata: { submissionId: SUBMISSION_ID, userId: JAMAL_ID } })],
  ...overrides,
})
