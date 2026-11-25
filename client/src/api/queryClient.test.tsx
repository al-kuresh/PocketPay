import { QueryClientProvider, useMutation, useQuery, type QueryClient } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { apiError, server } from '../test/server'
import { api, ApiError } from './client'
import { createQueryClient } from './queryClient'

function withClient(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** GET /thing answers each call in turn from `answers`; counts calls. */
function thingAnswers(...answers: Array<() => Response>) {
  const calls = { count: 0 }
  server.use(http.get('/api/v1/thing', () => answers[Math.min(calls.count++, answers.length - 1)]()))
  return calls
}

const useThing = () => useQuery({ queryKey: ['thing'], queryFn: () => api.get('/thing').then((r) => r.data) })

describe('QueryClient defaults', () => {
  it('a 4xx is never retried: a 404 makes exactly 1 request', async () => {
    const calls = thingAnswers(() => HttpResponse.json(apiError('NOT_FOUND'), { status: 404 }))
    const { result } = renderHook(useThing, { wrapper: withClient(createQueryClient()) })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(calls.count).toBe(1)
  })

  it('a network error is retried once, then the query succeeds', async () => {
    const calls = thingAnswers(
      () => HttpResponse.error(),
      () => HttpResponse.json({ ok: true }),
    )
    const { result } = renderHook(useThing, { wrapper: withClient(createQueryClient()) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 3000 })
    expect(calls.count).toBe(2)
  })

  it('a 5xx is retried at most once', async () => {
    const calls = thingAnswers(() => HttpResponse.json(apiError('INTERNAL_ERROR'), { status: 500 }))
    const { result } = renderHook(useThing, { wrapper: withClient(createQueryClient()) })
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 })
    expect(calls.count).toBe(2)
  })

  it('a failing mutation is never retried (exactly 1 request), even on a 5xx', async () => {
    let posts = 0
    server.use(
      http.post('/api/v1/thing', () => {
        posts++
        return HttpResponse.json(apiError('INTERNAL_ERROR'), { status: 500 })
      }),
    )
    const { result } = renderHook(() => useMutation({ mutationFn: () => api.post('/thing') }), {
      wrapper: withClient(createQueryClient()),
    })
    await expect(result.current.mutateAsync()).rejects.toBeInstanceOf(ApiError)
    await new Promise((r) => setTimeout(r, 1500)) // longer than a retry delay would be
    expect(posts).toBe(1)
  })
})
