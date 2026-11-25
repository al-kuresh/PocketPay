import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import bn from '../../i18n/bn.json'
import en from '../../i18n/en.json'
import { useLanguage } from '../../stores/language'
import { useSession } from '../../stores/session'
import { renderRoutes } from '../../test/render'
import { apiError, readMultipart, server, testUser, type SentFile } from '../../test/server'

type User = ReturnType<typeof renderRoutes>['user']

let pinBodies: unknown[]
let photoUrl: string | null
let meCalls: number

beforeEach(() => {
  pinBodies = []
  photoUrl = null
  meCalls = 0
  useSession.getState().signIn({ user: testUser({ name: 'Rahim Uddin', phone: '01800000002' }), accessToken: 't' })
  server.use(
    http.get('/api/v1/me', () => {
      meCalls += 1
      const user = { ...useSession.getState().user, profilePhotoUrl: photoUrl }
      return HttpResponse.json({ success: true, data: { user, wallet: { id: 'w1', type: 'CUSTOMER', balance: '0' } } })
    }),
    http.patch('/api/v1/auth/pin', async ({ request }) => {
      pinBodies.push(await request.json())
      return new HttpResponse(null, { status: 204 })
    }),
  )
})

afterEach(() => useLanguage.getState().setLang('en'))

async function changePin(user: User, current: string, next: string, confirm = next) {
  await user.type(await screen.findByLabelText(en.changePin.current), current)
  await user.type(screen.getByLabelText(en.changePin.new), next)
  await user.type(screen.getByLabelText(en.changePin.confirm), confirm)
  await user.click(screen.getByRole('button', { name: en.changePin.submit }))
}

const pinField = (label: string) => screen.getByLabelText(label) as HTMLInputElement

describe('Profile', () => {
  it('shows the name, phone, masked NID, role, shop name, status and KYC status', async () => {
    useSession.getState().signIn({
      user: testUser({ role: 'MERCHANT', name: 'Demo Owner', phone: '01800000005', shopName: 'Demo Store', nidMasked: '*******890' }),
      accessToken: 't',
    })
    renderRoutes('/profile')
    expect(await screen.findByText('Demo Owner')).toBeInTheDocument()
    expect(screen.getByText('01800000005')).toHaveClass('tabular-nums')
    expect(screen.getByText('*******890')).toBeInTheDocument()
    expect(screen.getByText(en.roles.MERCHANT)).toBeInTheDocument()
    expect(screen.getByText('Demo Store')).toBeInTheDocument()
    expect(screen.getByText(en.status.ACTIVE)).toBeInTheDocument()
    expect(screen.getByText(en.kycStatus.APPROVED)).toBeInTheDocument()
  })

  it('switching to Bangla changes the visible labels and <html lang>', async () => {
    const { user } = renderRoutes('/profile')
    expect(await screen.findByRole('heading', { level: 1, name: en.nav.profile })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
    await user.click(screen.getByRole('button', { name: en.language.bn }))
    expect(await screen.findByRole('heading', { level: 1, name: bn.nav.profile })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: bn.common.logout })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.common.logout })).not.toBeInTheDocument()
    expect(document.documentElement.lang).toBe('bn')
  })

  it('log out calls /auth/logout, clears the store and the cached data, and goes to /login', async () => {
    let logouts = 0
    server.use(
      http.post('/api/v1/auth/logout', () => {
        logouts += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { user, router, queryClient } = renderRoutes('/profile')
    await screen.findByText('Rahim Uddin')
    expect(queryClient.getQueryData(['me'])).toBeDefined()
    await user.click(screen.getByRole('button', { name: en.common.logout }))
    expect(await screen.findByRole('heading', { name: en.login.title })).toBeInTheDocument()
    expect(logouts).toBe(1)
    expect(useSession.getState()).toMatchObject({ status: 'anonymous', accessToken: null, user: null })
    expect(router.state.location.pathname).toBe('/login')
    // The next person to log in on this phone must not see this user's balance or history.
    expect(queryClient.getQueryData(['me'])).toBeUndefined()
  })

  it('change photo: sends the multipart field "photo", then the photo updates after me refetches', async () => {
    let sent: Record<string, SentFile> = {}
    server.use(
      http.put('/api/v1/me/photo', async ({ request }) => {
        sent = (await readMultipart(request)).files
        photoUrl = '/uploads/profile/u1/new.webp'
        return HttpResponse.json({ success: true, data: { user: { ...useSession.getState().user, profilePhotoUrl: photoUrl } } })
      }),
    )
    const { user } = renderRoutes('/profile')
    await screen.findByText('Rahim Uddin')
    expect(screen.queryByRole('img', { name: en.profile.photo })).not.toBeInTheDocument()
    const callsBefore = meCalls

    await user.upload(screen.getByLabelText(en.profile.changePhoto), new File(['jpeg-bytes'], 'me.jpg', { type: 'image/jpeg' }))

    expect(await screen.findByRole('img', { name: en.profile.photo })).toHaveAttribute('src', '/uploads/profile/u1/new.webp')
    expect(Object.keys(sent)).toEqual(['photo'])
    expect(sent.photo).toMatchObject({ name: 'me.jpg', type: 'image/jpeg' })
    expect(meCalls).toBeGreaterThan(callsBefore)
    expect(await screen.findByText(en.profile.photoChanged)).toBeInTheDocument()
  })

  it('a refused photo shows the translated error', async () => {
    server.use(http.put('/api/v1/me/photo', () => HttpResponse.json(apiError('UNSUPPORTED_FILE_TYPE'), { status: 415 })))
    const { user } = renderRoutes('/profile')
    await screen.findByText('Rahim Uddin')
    await user.upload(screen.getByLabelText(en.profile.changePhoto), new File(['%PDF'], 'me.jpg', { type: 'image/jpeg' }))
    expect(await screen.findByText(en.errors.UNSUPPORTED_FILE_TYPE)).toBeInTheDocument()
  })
})

describe('Change PIN', () => {
  it('from Profile: sends currentPin and newPin, shows a success toast and returns to Profile', async () => {
    const { user, router } = renderRoutes('/profile')
    await user.click(await screen.findByRole('link', { name: en.profile.changePin }))
    expect(router.state.location.pathname).toBe('/profile/pin')
    await changePin(user, '48213', '73915')
    expect(await screen.findByText(en.changePin.done)).toBeInTheDocument()
    expect(pinBodies).toEqual([{ currentPin: '48213', newPin: '73915' }])
    expect(router.state.location.pathname).toBe('/profile')
  })

  it('a wrong current PIN → the translated INVALID_PIN with attempts left; every PIN field is cleared', async () => {
    server.use(http.patch('/api/v1/auth/pin', () => HttpResponse.json(apiError('INVALID_PIN', { attemptsLeft: 2 }), { status: 403 })))
    const { user, router } = renderRoutes('/profile/pin')
    await changePin(user, '11223', '73915')
    expect(await screen.findByText(en.errors.INVALID_PIN_attempts_other.replace('{{count, number}}', '2'))).toBeInTheDocument()
    for (const label of [en.changePin.current, en.changePin.new, en.changePin.confirm]) expect(pinField(label).value).toBe('')
    expect(router.state.location.pathname).toBe('/profile/pin')
  })

  it('PIN_UNCHANGED → its translated message', async () => {
    server.use(http.patch('/api/v1/auth/pin', () => HttpResponse.json(apiError('PIN_UNCHANGED'), { status: 422 })))
    const { user } = renderRoutes('/profile/pin')
    await changePin(user, '73915', '73915')
    expect(await screen.findByText(en.errors.PIN_UNCHANGED)).toBeInTheDocument()
  })

  it('ACCOUNT_LOCKED → the translated message with the unlock time', async () => {
    server.use(
      http.patch('/api/v1/auth/pin', () =>
        HttpResponse.json(apiError('ACCOUNT_LOCKED', { lockedUntil: '2026-11-25T05:00:00.000Z' }), { status: 423 }),
      ),
    )
    const { user } = renderRoutes('/profile/pin')
    await changePin(user, '48213', '73915')
    const prefix = en.errors.ACCOUNT_LOCKED_until.split('{{')[0]
    expect(await screen.findByText((text) => text.startsWith(prefix) && text.includes('11:00'))).toBeInTheDocument()
  })

  it('a weak new PIN (12345) is blocked client-side, with no request', async () => {
    const { user } = renderRoutes('/profile/pin')
    await changePin(user, '48213', '12345')
    expect(await screen.findByText(en.validation.pinWeak)).toBeInTheDocument()
    expect(pinBodies).toEqual([])
  })

  it('a confirm that does not match is blocked client-side, with no request', async () => {
    const { user } = renderRoutes('/profile/pin')
    await changePin(user, '48213', '73915', '73916')
    expect(await screen.findByText(en.validation.pinMismatch)).toBeInTheDocument()
    expect(pinBodies).toEqual([])
  })
})
