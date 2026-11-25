import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSession } from '../stores/session'
import { apiError, server, testUser } from '../test/server'
import { me } from './auth'
import { api, ApiError, restoreSession } from './client'

const user = testUser()
let refreshCalls = 0

/** POST /auth/refresh answers each call in turn from `responses`, then 200 with token "new". */
function refreshAnswers(...responses: Array<[number, unknown]>) {
  server.use(
    http.post('/api/v1/auth/refresh', () => {
      const next = responses[refreshCalls++]
      return next
        ? HttpResponse.json(next[1] as object, { status: next[0] })
        : HttpResponse.json({ success: true, data: { user, accessToken: 'new' } })
    }),
  )
}

/** GET /me: 401 UNAUTHENTICATED unless the token is "new". Counts calls. */
function meAcceptsOnlyNewToken() {
  const calls = { count: 0 }
  server.use(
    http.get('/api/v1/me', ({ request }) => {
      calls.count++
      return request.headers.get('Authorization') === 'Bearer new'
        ? HttpResponse.json({ success: true, data: { user, wallet: null } })
        : HttpResponse.json(apiError('UNAUTHENTICATED'), { status: 401 })
    }),
  )
  return calls
}

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  const err = await p.then(
    () => {
      throw new Error('expected a rejection')
    },
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(ApiError)
  return err as ApiError
}

beforeEach(() => {
  refreshCalls = 0
  useSession.getState().signIn({ user, accessToken: 'old' })
})

describe('api client', () => {
  it('sends the access token from the store', async () => {
    let auth: string | null = null
    server.use(
      http.get('/api/v1/me', ({ request }) => {
        auth = request.headers.get('Authorization')
        return HttpResponse.json({ success: true, data: { user, wallet: null } })
      }),
    )
    await api.get('/me')
    expect(auth).toBe('Bearer old')
  })

  it('two parallel 401s share ONE refresh, and both retry with the new token', async () => {
    refreshAnswers()
    const me = meAcceptsOnlyNewToken()
    const [a, b] = await Promise.all([api.get('/me'), api.get('/me')])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(refreshCalls).toBe(1)
    expect(me.count).toBe(4)
    expect(useSession.getState().accessToken).toBe('new')
  })

  it('a refresh answered 409 REFRESH_IN_PROGRESS is retried once, then the request succeeds', async () => {
    refreshAnswers([409, apiError('REFRESH_IN_PROGRESS')])
    meAcceptsOnlyNewToken()
    const res = await api.get('/me')
    expect(res.status).toBe(200)
    expect(refreshCalls).toBe(2)
  })

  it('a second 409 is not retried again: the session is cleared', async () => {
    refreshAnswers([409, apiError('REFRESH_IN_PROGRESS')], [409, apiError('REFRESH_IN_PROGRESS')])
    meAcceptsOnlyNewToken()
    const err = await rejection(api.get('/me'))
    expect(err.code).toBe('REFRESH_IN_PROGRESS')
    expect(refreshCalls).toBe(2)
    expect(useSession.getState().status).toBe('anonymous')
  })

  it('a refresh answered 401 clears the session and rejects with an ApiError', async () => {
    refreshAnswers([401, apiError('REFRESH_TOKEN_INVALID')])
    meAcceptsOnlyNewToken()
    const err = await rejection(api.get('/me'))
    expect(err.status).toBe(401)
    expect(useSession.getState()).toMatchObject({ status: 'anonymous', accessToken: null, user: null })
  })

  it('never refreshes on a login, register or refresh request', async () => {
    refreshAnswers()
    server.use(
      http.post('/api/v1/auth/login', () => HttpResponse.json(apiError('UNAUTHENTICATED'), { status: 401 })),
      http.post('/api/v1/auth/register/complete', () =>
        HttpResponse.json(apiError('UNAUTHENTICATED'), { status: 401 }),
      ),
    )
    expect((await rejection(api.post('/auth/login', {}))).code).toBe('UNAUTHENTICATED')
    expect((await rejection(api.post('/auth/register/complete', {}))).code).toBe('UNAUTHENTICATED')
    expect(refreshCalls).toBe(0)
  })

  it('a retried request that 401s again is not refreshed a second time', async () => {
    refreshAnswers()
    let meCalls = 0
    server.use(
      http.get('/api/v1/me', () => {
        meCalls++
        return HttpResponse.json(apiError('UNAUTHENTICATED'), { status: 401 })
      }),
    )
    const err = await rejection(api.get('/me'))
    expect(err.code).toBe('UNAUTHENTICATED')
    expect(refreshCalls).toBe(1)
    expect(meCalls).toBe(2)
  })

  it('a 401 with another code is not refreshed', async () => {
    refreshAnswers()
    server.use(
      http.get('/api/v1/me', () => HttpResponse.json(apiError('INVALID_CREDENTIALS'), { status: 401 })),
    )
    expect((await rejection(api.get('/me'))).code).toBe('INVALID_CREDENTIALS')
    expect(refreshCalls).toBe(0)
  })

  it('an error body becomes an ApiError with status, code and details', async () => {
    server.use(
      http.post('/api/v1/transactions/preview', () =>
        HttpResponse.json(apiError('INSUFFICIENT_BALANCE', { x: 1 }), { status: 422 }),
      ),
    )
    const err = await rejection(api.post('/transactions/preview', {}))
    expect(err).toMatchObject({ status: 422, code: 'INSUFFICIENT_BALANCE', details: { x: 1 } })
  })

  it('a network failure becomes an ApiError with code NETWORK_ERROR', async () => {
    server.use(http.get('/api/v1/me', () => HttpResponse.error()))
    const err = await rejection(api.get('/me'))
    expect(err).toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
  })
})

describe('me(): keeping the session user in sync', () => {
  /** GET /me answers with `who`, but only once `release()` is called. */
  function heldMe(who: ReturnType<typeof testUser>) {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    server.use(
      http.get('/api/v1/me', async () => {
        await held
        return HttpResponse.json({ success: true, data: { user: who, wallet: null } })
      }),
    )
    return () => release()
  }

  it('the same user: /me updates the session user (e.g. a KYC approval)', async () => {
    const pending = testUser({ status: 'PENDING_KYC' })
    useSession.getState().signIn({ user: pending, accessToken: 'a' })
    const release = heldMe({ ...pending, status: 'ACTIVE' })
    const call = me()
    release()
    await call
    expect(useSession.getState().user?.status).toBe('ACTIVE')
  })

  it("A's /me answering after A logged out and B logged in does not overwrite B", async () => {
    const a = testUser({ id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'User A' })
    const b = testUser({ id: 'bbbbbbbb-0000-4000-8000-000000000002', name: 'User B' })
    useSession.getState().signIn({ user: a, accessToken: 'a-token' })
    const release = heldMe(a)
    const call = me()

    useSession.getState().clear() // A logs out…
    useSession.getState().signIn({ user: b, accessToken: 'b-token' }) // …and B logs in on the same phone
    release()
    await call

    expect(useSession.getState().user).toEqual(b)
  })
})

describe('restoreSession', () => {
  beforeEach(() => useSession.setState({ accessToken: null, user: null, status: 'loading' }))

  it('200 → authenticated with the user and the token', async () => {
    refreshAnswers()
    await restoreSession()
    expect(useSession.getState()).toMatchObject({ status: 'authenticated', user, accessToken: 'new' })
  })

  it('401 → anonymous', async () => {
    refreshAnswers([401, apiError('REFRESH_TOKEN_INVALID')])
    await restoreSession()
    expect(useSession.getState()).toMatchObject({ status: 'anonymous', user: null, accessToken: null })
  })
})
