import { useSession } from '../stores/session'
import { api } from './client'
import type { Envelope, MeData, SessionData } from './types'

/** POST /auth/login. On success the session is in the store; returns the user. */
export async function login(phone: string, pin: string) {
  const { data } = await api.post<Envelope<SessionData>>('/auth/login', { phone, pin })
  useSession.getState().signIn(data.data)
  return data.data.user
}

/** POST /auth/logout. The token is dropped from memory even if the call fails. */
export async function logout() {
  try {
    await api.post('/auth/logout')
  } finally {
    useSession.getState().clear()
  }
}

/** The single-flight refresh (a raw second refresh would race the cookie rotation). */
export { refreshSession as refresh } from './client'

/** GET /me: the user and their wallet (null for admins). */
export async function me() {
  const { data } = await api.get<Envelope<MeData>>('/me')
  // Keep the session's user current: a KYC approval (or a new photo) reaches the guards and money buttons without a new login.
  // Only for the same user: a late answer for A (who logged out) must not overwrite B, signed in since.
  const session = useSession.getState()
  if (session.status === 'authenticated' && session.user?.id === data.data.user.id) useSession.setState({ user: data.data.user })
  return data.data
}
