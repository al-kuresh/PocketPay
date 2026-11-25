import { QueryClient } from '@tanstack/react-query'
import { useSession } from '../stores/session'
import { ApiError } from './client'

/** Only a transient failure is worth retrying: no answer at all, or the server's own fault (5xx). */
const isTransient = (error: unknown) => error instanceof ApiError && (error.code === 'NETWORK_ERROR' || error.status >= 500)

export function createQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      // A 4xx won't change on a retry (and a 404 receipt must show "not found" now, not after ~7 s of backoff).
      queries: { retry: (failureCount, error) => failureCount < 1 && isTransient(error) },
      // Never retry a write: the money POSTs retry only by the user's "Try again", with the same Idempotency-Key.
      mutations: { retry: false },
    },
  })
  // Signed out (logout or a failed refresh): drop the cache, so the next user on this phone never sees this one's balance or history.
  useSession.subscribe((s, prev) => {
    if (s.status === 'anonymous' && prev.status !== 'anonymous') client.clear()
  })
  return client
}
