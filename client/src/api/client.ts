import axios, { type InternalAxiosRequestConfig } from 'axios'
import { useSession } from '../stores/session'
import type { Envelope, ErrorBody, SessionData } from './types'

export const api = axios.create({ baseURL: '/api/v1', withCredentials: true })

/** Every failed call rejects with this. A network failure (no response) is status 0, code NETWORK_ERROR. */
export class ApiError extends Error {
  status: number
  code: string
  details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

function toApiError(error: unknown): ApiError {
  if (axios.isAxiosError(error) && error.response) {
    const body = (error.response.data as Partial<ErrorBody> | undefined)?.error
    return new ApiError(error.response.status, body?.code ?? 'UNKNOWN', body?.message ?? error.message, body?.details)
  }
  return new ApiError(0, 'NETWORK_ERROR', error instanceof Error ? error.message : 'Network error')
}

// A 401 on these means "bad credentials / bad cookie", not "access token expired": refreshing would be wrong or loop.
const NO_REFRESH = /^\/auth\/(login|register|refresh)/

let refreshing: Promise<string> | null = null

/** Swap the refresh cookie for a new access token. Single-flight: concurrent callers share one request. */
export function refreshSession(): Promise<string> {
  // .finally runs asynchronously, so `refreshing` is always set before it is reset.
  refreshing ??= doRefresh().finally(() => {
    refreshing = null
  })
  return refreshing
}

async function doRefresh(): Promise<string> {
  const post = () => api.post<Envelope<SessionData>>('/auth/refresh').then((r) => r.data.data)
  try {
    let data: SessionData
    try {
      data = await post()
    } catch (e) {
      // Another tab rotated the cookie a moment ago; the browser now holds the new one (api.md, design §10).
      if (!(e instanceof ApiError && e.code === 'REFRESH_IN_PROGRESS')) throw e
      await new Promise((resolve) => setTimeout(resolve, 300))
      data = await post()
    }
    useSession.getState().signIn(data)
    return data.accessToken
  } catch (e) {
    useSession.getState().clear() // status 'anonymous': RequireAuth sends the user to /login
    throw e
  }
}

/** On app start: the httpOnly cookie may still hold a session. Ends 'authenticated' or 'anonymous', never throws. */
export async function restoreSession(): Promise<void> {
  await refreshSession().catch(() => {})
}

type RetryConfig = InternalAxiosRequestConfig & { _retried?: boolean }

api.interceptors.request.use((config) => {
  const token = useSession.getState().accessToken
  // A caller's own Authorization (the registration token on register/complete) wins.
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(undefined, async (error: unknown) => {
  const err = toApiError(error)
  const config = axios.isAxiosError(error) ? (error.config as RetryConfig | undefined) : undefined
  if (err.status !== 401 || err.code !== 'UNAUTHENTICATED' || !config || config._retried || NO_REFRESH.test(config.url ?? '')) {
    throw err
  }
  config._retried = true
  // Sent with a token that has since been replaced (a refresh finished meanwhile)? Just retry with the new one.
  const current = useSession.getState().accessToken
  const token =
    current && config.headers.Authorization !== `Bearer ${current}` ? current : await refreshSession()
  config.headers.Authorization = `Bearer ${token}`
  return api(config)
})
