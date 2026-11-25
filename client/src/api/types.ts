// Response shapes from docs/api.md. Money is poisha as a string, never a number.

export type Role = 'CUSTOMER' | 'AGENT' | 'MERCHANT' | 'ADMIN'
export type UserStatus = 'PENDING_KYC' | 'ACTIVE' | 'FROZEN' | 'REJECTED'
export type KycStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface PublicUser {
  id: string
  phone: string
  name: string
  role: Role
  status: UserStatus
  shopName: string | null
  nidMasked: string
  profilePhotoUrl: string | null
  kycStatus: KycStatus | null
}

export interface Wallet {
  id: string
  type: Exclude<Role, 'ADMIN'>
  balance: string
}

/** Login, refresh and registration all answer with this. */
export interface SessionData {
  user: PublicUser
  accessToken: string
}

export interface MeData {
  user: PublicUser
  wallet: Wallet | null
}

/** `{ success: true, data }`: every 2xx JSON body. */
export interface Envelope<T> {
  success: true
  data: T
}

/** `{ success: false, error }`: every error JSON body. */
export interface ErrorBody {
  success: false
  error: { code: string; message: string; details?: unknown }
}
