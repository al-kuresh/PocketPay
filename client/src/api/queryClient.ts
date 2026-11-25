import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './client'

/** Only a transient failure is worth retrying: no answer at all, or the server's own fault (5xx). */
const isTransient = (error: unknown) => error instanceof ApiError && (error.code === 'NETWORK_ERROR' || error.status >= 500)

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // A 4xx won't change on a retry (and a 404 receipt must show "not found" now, not after ~7 s of backoff).
      queries: { retry: (failureCount, error) => failureCount < 1 && isTransient(error) },
      // Never retry a write: the money POSTs retry only by the user's "Try again", with the same Idempotency-Key.
      mutations: { retry: false },
    },
  })
}
