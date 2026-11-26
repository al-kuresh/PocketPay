// /admin/* (docs/api.md and the Phase 7a Task 3-5 report). Every response is Cache-Control: no-store on the server;
// on the client these live only in React Query's memory, never in storage. The full NID is only in KycDetail.
import { api } from './client'
import type { Envelope, KycStatus, Role, UserStatus } from './types'

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export interface KycListItem {
  id: string
  submittedAt: string
  status: KycStatus
  user: { id: string; name: string; phone: string; role: Role; shopName: string | null; nidMasked: string }
}

/** GET /admin/kyc/:id. `images` are signed links that work for 300 s. */
export interface KycDetail {
  id: string
  status: KycStatus
  submittedAt: string
  reviewedAt: string | null
  reason: string | null
  reviewedBy: { id: string; name: string } | null
  isLatest: boolean
  user: {
    id: string
    name: string
    phone: string
    role: Role
    shopName: string | null
    dateOfBirth: string
    nidNumber: string
    status: UserStatus
  }
  images: { nidFront: string; nidBack: string; selfie: string }
  /** The user's other submissions, newest first. */
  history: Array<{ id: string; status: KycStatus; submittedAt: string; reason: string | null }>
}

export type KycDecision = { decision: 'APPROVE' } | { decision: 'REJECT'; reason: string }

export interface AdminUser {
  id: string
  name: string
  phone: string
  role: Role
  status: UserStatus
  shopName: string | null
  nidMasked: string
  kycStatus: KycStatus | null
  lockedUntil: string | null
  createdAt: string
}

export interface AuditItem {
  id: string
  createdAt: string
  action: string
  actor: { id: string; name: string; role: Role } | null
  targetType: string | null
  targetId: string | null
  metadata: unknown
  ip: string | null
}

export interface AdminUserDetail extends AdminUser {
  failedPinAttempts: number
  /** Poisha as a string; null for an admin (no wallet). */
  balance: string | null
  latestKyc: { id: string; status: KycStatus } | null
  recentAudit: AuditItem[]
}

const get = async <T>(url: string, params?: object) => (await api.get<Envelope<T>>(url, { params })).data.data

export const listKyc = (params: { status: KycStatus; cursor?: string; limit?: number }) =>
  get<Page<KycListItem> & { pendingCount: number }>('/admin/kyc', params)

export const getKyc = (id: string) => get<KycDetail>(`/admin/kyc/${encodeURIComponent(id)}`)

export async function reviewKyc(id: string, body: KycDecision) {
  const { data } = await api.patch<Envelope<{ id: string; status: KycStatus; reviewedAt: string; reason: string | null }>>(
    `/admin/kyc/${encodeURIComponent(id)}`,
    body,
  )
  return data.data
}

export const listUsers = (params: { q?: string; role?: Role; status?: UserStatus; cursor?: string }) =>
  get<Page<AdminUser>>('/admin/users', params)

export const getUser = (id: string) => get<AdminUserDetail>(`/admin/users/${encodeURIComponent(id)}`)

export async function changeUserStatus(id: string, body: { action: 'FREEZE' | 'UNFREEZE'; reason: string }) {
  const { data } = await api.patch<Envelope<{ id: string; status: UserStatus }>>(`/admin/users/${encodeURIComponent(id)}/status`, body)
  return data.data
}

export async function unlockUser(id: string) {
  const { data } = await api.post<Envelope<{ id: string; unlocked: boolean }>>(`/admin/users/${encodeURIComponent(id)}/unlock`)
  return data.data
}

export const listAudit = (params: { action?: string; from?: string; to?: string; cursor?: string }) =>
  get<Page<AuditItem>>('/admin/audit-logs', params)
