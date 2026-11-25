import { create } from 'zustand'
import type { PublicUser, SessionData } from '../api/types'

// The access token lives here, in memory only: never localStorage or sessionStorage.
// A page reload loses it on purpose; restoreSession() gets a new one from the httpOnly refresh cookie.
interface SessionState {
  accessToken: string | null
  user: PublicUser | null
  status: 'loading' | 'authenticated' | 'anonymous'
  signIn(data: SessionData): void
  setToken(t: string): void
  clear(): void
}

export const useSession = create<SessionState>()((set) => ({
  accessToken: null,
  user: null,
  status: 'loading',
  signIn: ({ user, accessToken }) => set({ user, accessToken, status: 'authenticated' }),
  setToken: (accessToken) => set({ accessToken }),
  clear: () => set({ accessToken: null, user: null, status: 'anonymous' }),
}))
