import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import bn from '../../i18n/bn.json'
import en from '../../i18n/en.json'
import { renderRoutes } from '../../test/render'
import { useLanguage } from '../../stores/language'
import { useSession } from '../../stores/session'
import { apiError, server, testUser } from '../../test/server'
import type { PublicUser } from '../../api/types'

let loginBodies: Array<{ phone: string; pin: string }>

/** POST /auth/login answers with `user` (or the given error) and records each body. */
function loginAnswers(answer: PublicUser | [number, unknown]) {
  server.use(
    http.post('/api/v1/auth/login', async ({ request }) => {
      loginBodies.push((await request.json()) as { phone: string; pin: string })
      return Array.isArray(answer)
        ? HttpResponse.json(answer[1] as object, { status: answer[0] })
        : HttpResponse.json({ success: true, data: { user: answer, accessToken: 'acc' } })
    }),
  )
}

const visit = (path = '/login') => renderRoutes(path)

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, phone: string, pin: string, t = en) {
  await user.type(screen.getByLabelText(t.login.phone), phone)
  await user.type(screen.getByLabelText(t.login.pin), pin)
  await user.click(screen.getByRole('button', { name: t.login.submit }))
}

beforeEach(() => {
  loginBodies = []
  useSession.getState().clear()
})
afterEach(() => {
  act(() => useLanguage.getState().setLang('en'))
  localStorage.clear()
})

describe('Login', () => {
  it('success → the store is authenticated and the route is the customer home', async () => {
    loginAnswers(testUser({ role: 'CUSTOMER' }))
    const { router, user } = visit()
    await fillAndSubmit(user, '01800000002', '48213')
    expect(await screen.findByRole('heading', { name: en.nav.home })).toBeInTheDocument()
    expect(useSession.getState()).toMatchObject({ status: 'authenticated', accessToken: 'acc' })
    expect(router.state.location.pathname).toBe('/')
    expect(loginBodies).toEqual([{ phone: '01800000002', pin: '48213' }])
  })

  it('Bangla digits in the phone and PIN are sent as ASCII', async () => {
    loginAnswers(testUser())
    const { user } = visit()
    await fillAndSubmit(user, '০১৮০০০০০০০২', '৪৮২১৩')
    await screen.findByRole('heading', { name: en.nav.home })
    expect(loginBodies).toEqual([{ phone: '01800000002', pin: '48213' }])
  })

  it('wrong PIN → the translated INVALID_CREDENTIALS with attempts left, and the PIN is cleared', async () => {
    loginAnswers([401, apiError('INVALID_CREDENTIALS', { attemptsLeft: 2 })])
    const { user } = visit()
    await fillAndSubmit(user, '01800000002', '11223')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.INVALID_CREDENTIALS_attempts_other.replace('{{count, number}}', '2'))
    expect(alert).not.toHaveTextContent('INVALID_CREDENTIALS (test)')
    expect(screen.getByLabelText(en.login.pin)).toHaveValue('')
    expect(useSession.getState().status).toBe('anonymous')
  })

  it('ACCOUNT_LOCKED shows the unlock time, in Dhaka time and in the chosen language', async () => {
    loginAnswers([423, apiError('ACCOUNT_LOCKED', { lockedUntil: '2026-11-24T18:30:00Z' })])
    act(() => useLanguage.getState().setLang('bn'))
    const { user } = visit()
    await fillAndSubmit(user, '01800000002', '48213', bn)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('২৫ নভে, ২০২৬, ১২:৩০ AM')
    act(() => useLanguage.getState().setLang('en'))
    expect(screen.getByRole('alert')).toHaveTextContent('25 Nov 2026, 12:30 am')
  })

  it('a bad phone or a short PIN is stopped before any request', async () => {
    const { user } = visit()
    await fillAndSubmit(user, '0123', '482')
    expect(await screen.findByText(en.validation.phone)).toBeInTheDocument()
    expect(screen.getByText(en.validation.pin)).toBeInTheDocument()
    expect(loginBodies).toEqual([])
  })

  it('the demo Agent button logs in as the agent', async () => {
    loginAnswers(testUser({ role: 'AGENT', phone: '01800000004' }))
    const { user } = visit()
    await user.click(screen.getByRole('button', { name: en.login.demo.AGENT }))
    // The agent's home: its own money action, Cash In.
    expect(await screen.findByRole('button', { name: en.flows.CASH_IN.title })).toBeInTheDocument()
    expect(loginBodies).toEqual([{ phone: '01800000004', pin: '48213' }])
  })

  it('each demo card: the role as its name (in the display face), its seeded number as its description', async () => {
    renderRoutes('/login')
    for (const [role, phone] of [['CUSTOMER', '01800000002'], ['AGENT', '01800000004'], ['MERCHANT', '01800000005'], ['ADMIN', '01800000001']] as const) {
      const card = await screen.findByRole('button', { name: en.login.demo[role] })
      expect(card).toHaveAccessibleDescription(phone)
      expect(screen.getByText(en.login.demo[role])).toHaveClass('font-display')
    }
  })

  it('the four demo buttons use the seeded phones', async () => {
    loginAnswers([401, apiError('INVALID_CREDENTIALS')])
    const { user } = visit()
    for (const role of ['CUSTOMER', 'MERCHANT', 'ADMIN'] as const) {
      await user.click(screen.getByRole('button', { name: en.login.demo[role] }))
      await screen.findByRole('alert')
    }
    expect(loginBodies.map((b) => b.phone)).toEqual(['01800000002', '01800000005', '01800000001'])
  })

  it('an admin login → the KYC queue, whose Log out goes back to /login', async () => {
    loginAnswers(testUser({ role: 'ADMIN', phone: '01800000001' }))
    let logouts = 0
    server.use(
      http.post('/api/v1/auth/logout', () => {
        logouts++
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { router, user } = visit()
    await user.click(screen.getByRole('button', { name: en.login.demo.ADMIN }))
    expect(await screen.findByRole('heading', { level: 1, name: en.admin.nav.kyc })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/admin/kyc')
    // Below lg (jsdom has no matchMedia) Log out is in the menu sheet.
    await user.click(screen.getByRole('button', { name: en.admin.nav.menu }))
    await user.click(screen.getByRole('button', { name: en.common.logout }))
    expect(await screen.findByRole('heading', { name: en.login.title })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(logouts).toBe(1)
    expect(useSession.getState().status).toBe('anonymous')
  })

  it('a PENDING_KYC customer lands on home with the KYC banner', async () => {
    loginAnswers(testUser({ status: 'PENDING_KYC', kycStatus: 'PENDING' }))
    const { user } = visit()
    await fillAndSubmit(user, '01800000002', '48213')
    expect(await screen.findByText(en.kyc.pending.title)).toBeInTheDocument()
  })

  it('links to registration', () => {
    visit()
    expect(screen.getByRole('link', { name: en.login.register })).toHaveAttribute('href', '/register')
  })
})
