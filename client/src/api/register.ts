import { useSession } from '../stores/session'
import { api } from './client'
import type { Envelope, OtpSent, OtpVerified, SessionData } from './types'

/** Step 1: send a 6-digit code to the phone. */
export async function requestOtp(phone: string) {
  const { data } = await api.post<Envelope<OtpSent>>('/auth/register/request-otp', { phone })
  return data.data
}

/** Step 2: check the code; returns the registration token, which the caller keeps in memory only. */
export async function verifyOtp(phone: string, code: string) {
  const { data } = await api.post<Envelope<OtpVerified>>('/auth/register/verify-otp', { phone, code })
  return data.data
}

/**
 * Steps 3 + 4: one multipart request with the fields and the 3 photos. The registration token goes in this
 * request's own Authorization header (the client keeps a caller's header). On success the user is logged in.
 */
export async function completeRegistration(registrationToken: string, form: FormData) {
  const { data } = await api.post<Envelope<SessionData>>('/auth/register/complete', form, {
    headers: { Authorization: `Bearer ${registrationToken}` },
  })
  useSession.getState().signIn(data.data)
  return data.data.user
}
