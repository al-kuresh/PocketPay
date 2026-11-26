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

/** GET /kyc. `reason` is the admin's text for a rejection (null while pending). */
export interface KycInfo {
  status: KycStatus
  reason: string | null
  submittedAt: string
  reviewedAt: string | null
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

export type TxType = 'SEND_MONEY' | 'CASH_OUT' | 'PAYMENT' | 'CASH_IN'

/** One side of a transaction, masked by the server. A system wallet is `{ name: 'PocketPay', phone: null, role: 'SYSTEM' }`. */
export interface Party {
  name: string
  phone: string | null
  role: Wallet['type'] | 'SYSTEM'
}

/** GET /wallets/lookup. */
export interface LookupResult {
  name: string
  role: Wallet['type']
}

/** POST /transactions/preview. `total` is what leaves the sender's wallet. */
export interface Preview {
  type: TxType
  amount: string
  fee: string
  total: string
  receiver: Party
}

/** A money POST's receipt and GET /transactions/:trxId. `mine.amount` is SIGNED ("-50500" out, "+50000" or "50000" in). */
export interface Receipt {
  trxId: string
  type: TxType | 'FLOAT_TOPUP'
  status: string
  amount: string
  fee: string
  note: string | null
  createdAt: string
  from: Party
  to: Party
  mine: { amount: string; balanceAfter: string }
}

/** One GET /transactions row. `amount` is unsigned; `direction` says which way. */
export interface HistoryItem {
  trxId: string
  type: TxType | 'FLOAT_TOPUP'
  direction: 'IN' | 'OUT'
  amount: string
  counterparty: Party
  balanceAfter: string
  createdAt: string
}

export interface HistoryPage {
  items: HistoryItem[]
  nextCursor: string | null
}

/** POST /auth/register/request-otp. `devOtp` only when the server echoes codes (dev and demo: no SMS gateway). */
export interface OtpSent {
  expiresInSeconds: number
  resendInSeconds: number
  devOtp?: string
}

/** POST /auth/register/verify-otp. */
export interface OtpVerified {
  registrationToken: string
  expiresInSeconds: number
}
