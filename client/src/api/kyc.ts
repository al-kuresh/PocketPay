import { useSession } from '../stores/session'
import { api } from './client'
import type { Envelope, KycInfo, PublicUser } from './types'

/** GET /kyc: the caller's latest submission (null when there is none). */
export async function myKyc() {
  const { data } = await api.get<Envelope<KycInfo | null>>('/kyc')
  return data.data
}

/** POST /kyc/resubmit: one multipart request with `nidFront`, `nidBack`, `selfie`. Puts the new status in the session at once. */
export async function resubmitKyc(form: FormData) {
  const { data } = await api.post<Envelope<{ user: PublicUser; kyc: KycInfo }>>('/kyc/resubmit', form)
  // Only for the same user, as in me(): a late answer must never overwrite someone signed in since.
  if (useSession.getState().user?.id === data.data.user.id) useSession.setState({ user: data.data.user })
  return data.data
}
