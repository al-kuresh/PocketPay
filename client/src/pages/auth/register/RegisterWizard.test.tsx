import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../i18n/en.json'
import { routes } from '../../../routes/router'
import { useSession } from '../../../stores/session'
import { apiError, readMultipart, server, testUser, type SentFile } from '../../../test/server'

const TOKEN = 'reg-token-6f1c2a7e'
type User = ReturnType<typeof userEvent.setup>

interface Captured {
  auth: string | null
  fields: Record<string, string>
  files: Record<string, SentFile>
}
let completes: Captured[]
let completeAnswer: [number, unknown]

beforeEach(() => {
  completes = []
  completeAnswer = [
    201,
    { success: true, data: { user: testUser({ status: 'PENDING_KYC', kycStatus: 'PENDING' }), accessToken: 'acc' } },
  ]
  useSession.getState().clear()
  server.use(
    http.post('/api/v1/auth/register/request-otp', () =>
      HttpResponse.json({ success: true, data: { expiresInSeconds: 300, resendInSeconds: 60, devOtp: '482913' } }),
    ),
    http.post('/api/v1/auth/register/verify-otp', async ({ request }) => {
      const body = (await request.json()) as { phone: string; code: string }
      return body.code === '482913'
        ? HttpResponse.json({ success: true, data: { registrationToken: TOKEN, expiresInSeconds: 900 } })
        : HttpResponse.json(apiError('OTP_INVALID', { attemptsLeft: 4 }), { status: 400 })
    }),
    http.post('/api/v1/auth/register/complete', async ({ request }) => {
      const auth = request.headers.get('Authorization')
      completes.push({ auth, ...(await readMultipart(request)) })
      return HttpResponse.json(completeAnswer[1] as object, { status: completeAnswer[0] })
    }),
  )
})
afterEach(() => vi.restoreAllMocks())

function visit() {
  const router = createMemoryRouter(routes, { initialEntries: ['/register'] })
  render(<RouterProvider router={router} />)
  return { router, user: userEvent.setup() }
}

const photo = (name: string) => new File([new Uint8Array(1000)], name, { type: 'image/jpeg' })

async function phoneStep(user: User) {
  await user.type(screen.getByLabelText(en.register.phone.label), '01700000000')
  await user.click(screen.getByRole('button', { name: en.register.phone.submit }))
}
async function otpStep(user: User, code = '482913') {
  await user.type(await screen.findByLabelText(en.register.otp.label), code)
  await user.click(screen.getByRole('button', { name: en.register.otp.submit }))
}
async function identityStep(user: User, opts: { dob?: string; role?: 'CUSTOMER' | 'AGENT' | 'MERCHANT'; shop?: string } = {}) {
  await user.type(await screen.findByLabelText(en.register.identity.name), 'Test User')
  await user.type(screen.getByLabelText(en.register.identity.dob), opts.dob ?? '1995-06-15')
  await user.type(screen.getByLabelText(en.register.identity.nid), '1234567890')
  if (opts.role) await user.click(screen.getByRole('radio', { name: en.roles[opts.role] }))
  if (opts.shop) await user.type(screen.getByLabelText(en.register.identity.shopName), opts.shop)
  await user.click(screen.getByRole('button', { name: en.register.identity.submit }))
}
async function photosStep(user: User, pin = '48213', confirm = pin) {
  await user.upload(await screen.findByLabelText(en.register.photos.nidFront), photo('front.jpg'))
  await user.upload(screen.getByLabelText(en.register.photos.nidBack), photo('back.jpg'))
  await user.upload(screen.getByLabelText(en.register.photos.selfie), photo('selfie.jpg'))
  await user.type(screen.getByLabelText(en.register.photos.pin), pin)
  await user.type(screen.getByLabelText(en.register.photos.confirmPin), confirm)
  await user.click(screen.getByRole('button', { name: en.register.photos.submit }))
}

const stepHeading = (name: string) => screen.findByRole('heading', { name })
const progress = () => screen.getByRole('progressbar')

describe('RegisterWizard', () => {
  it('the happy path through all 4 steps sends ONE multipart request with the 3 files and the fields', async () => {
    const { router, user } = visit()
    expect(progress()).toHaveAttribute('aria-valuenow', '1')
    await phoneStep(user)
    expect(await screen.findByText(/482913/)).toBeInTheDocument() // the dev OTP hint
    expect(progress()).toHaveAttribute('aria-valuenow', '2')
    await otpStep(user)
    await stepHeading(en.register.identity.heading)
    expect(progress()).toHaveAttribute('aria-valuenow', '3')
    await identityStep(user)
    await stepHeading(en.register.photos.heading)
    expect(screen.getByText(en.kyc.demo)).toBeInTheDocument()
    await photosStep(user)

    // logged in, on home, with the KYC banner
    expect(await screen.findByText(en.kyc.pending.title)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(useSession.getState().status).toBe('authenticated')

    expect(completes).toHaveLength(1)
    const [sent] = completes
    expect(sent.auth).toBe(`Bearer ${TOKEN}`)
    expect(sent.fields).toEqual({
      name: 'Test User',
      dateOfBirth: '1995-06-15',
      nidNumber: '1234567890',
      role: 'CUSTOMER',
      pin: '48213',
      confirmPin: '48213',
    })
    expect(Object.keys(sent.files).sort()).toEqual(['nidBack', 'nidFront', 'selfie'])
    expect(sent.files.nidFront).toEqual({ name: 'front.jpg', type: 'image/jpeg', size: 1000 })
    expect(sent.files.nidBack).toEqual({ name: 'back.jpg', type: 'image/jpeg', size: 1000 })
    expect(sent.files.selfie).toEqual({ name: 'selfie.jpg', type: 'image/jpeg', size: 1000 })
  })

  it('Back from step 4 keeps step 3 filled in, and it can continue (a customer has no shop name)', async () => {
    const { user } = visit()
    await phoneStep(user)
    await otpStep(user)
    await identityStep(user)
    await stepHeading(en.register.photos.heading)
    await user.click(screen.getByRole('button', { name: en.common.back }))
    expect(await screen.findByLabelText(en.register.identity.name)).toHaveValue('Test User')
    expect(screen.getByLabelText(en.register.identity.nid)).toHaveValue('1234567890')
    await user.click(screen.getByRole('button', { name: en.register.identity.submit }))
    expect(await stepHeading(en.register.photos.heading)).toBeInTheDocument()
  })

  it('the selfie picker opens the front camera', async () => {
    const { user } = visit()
    await phoneStep(user)
    await otpStep(user)
    await identityStep(user)
    expect(await screen.findByLabelText(en.register.photos.selfie)).toHaveAttribute('capture', 'user')
  })

  it('the shop-name field appears only for a merchant, and is sent', async () => {
    const { user } = visit()
    await phoneStep(user)
    await otpStep(user)
    await stepHeading(en.register.identity.heading)
    expect(screen.queryByLabelText(en.register.identity.shopName)).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: en.roles.AGENT }))
    expect(screen.queryByLabelText(en.register.identity.shopName)).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: en.roles.MERCHANT }))
    expect(screen.getByLabelText(en.register.identity.shopName)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: en.roles.CUSTOMER }))
    await identityStep(user, { role: 'MERCHANT', shop: 'Rahim Store' })
    await photosStep(user)
    await screen.findByText(en.kyc.pending.title)
    expect(completes[0].fields).toMatchObject({ role: 'MERCHANT', shopName: 'Rahim Store' })
  })

  it('a merchant without a shop name is blocked', async () => {
    const { user } = visit()
    await phoneStep(user)
    await otpStep(user)
    await identityStep(user, { role: 'MERCHANT' })
    expect(await screen.findByText(en.validation.shopName)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: en.register.identity.heading })).toBeInTheDocument()
  })

  it('an under-18 date of birth is blocked client-side', async () => {
    const { user } = visit()
    await phoneStep(user)
    await otpStep(user)
    await identityStep(user, { dob: `${new Date().getUTCFullYear() - 17}-12-31` })
    expect(await screen.findByText(en.validation.under18)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: en.register.identity.heading })).toBeInTheDocument()
    expect(progress()).toHaveAttribute('aria-valuenow', '3')
  })

  it('PIN ≠ confirm is blocked, and nothing is sent', async () => {
    const { user } = visit()
    await phoneStep(user)
    await otpStep(user)
    await identityStep(user)
    await photosStep(user, '48213', '48214')
    expect(await screen.findByText(en.validation.pinMismatch)).toBeInTheDocument()
    expect(completes).toHaveLength(0)
  })

  it('a weak PIN (a run like 12345) is blocked, and nothing is sent', async () => {
    const { user } = visit()
    await phoneStep(user)
    await otpStep(user)
    await identityStep(user)
    await photosStep(user, '12345')
    expect(await screen.findByText(en.validation.pinWeak)).toBeInTheDocument()
    expect(completes).toHaveLength(0)
  })

  it('missing photos are blocked, and nothing is sent', async () => {
    const { user } = visit()
    await phoneStep(user)
    await otpStep(user)
    await identityStep(user)
    await stepHeading(en.register.photos.heading)
    await user.type(screen.getByLabelText(en.register.photos.pin), '48213')
    await user.type(screen.getByLabelText(en.register.photos.confirmPin), '48213')
    await user.click(screen.getByRole('button', { name: en.register.photos.submit }))
    expect(await screen.findAllByText(en.validation.photo)).toHaveLength(3)
    expect(completes).toHaveLength(0)
  })

  it('a wrong code → the translated OTP_INVALID with attempts left', async () => {
    const { user } = visit()
    await phoneStep(user)
    await otpStep(user, '000000')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      en.errors.OTP_INVALID_attempts_other.replace('{{count, number}}', '4'),
    )
  })

  it('an expired registration token → back to step 1 with a message (phone kept)', async () => {
    completeAnswer = [401, apiError('REGISTRATION_TOKEN_INVALID')]
    const { user } = visit()
    await phoneStep(user)
    await otpStep(user)
    await identityStep(user)
    await photosStep(user)
    expect(await stepHeading(en.register.phone.heading)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.REGISTRATION_TOKEN_INVALID)
    expect(screen.getByLabelText(en.register.phone.label)).toHaveValue('01700000000')
    expect(progress()).toHaveAttribute('aria-valuenow', '1')
    expect(useSession.getState().status).toBe('anonymous')
  })

  it('another failure stays on step 4, with the PINs cleared', async () => {
    completeAnswer = [409, apiError('NID_TAKEN')]
    const { user } = visit()
    await phoneStep(user)
    await otpStep(user)
    await identityStep(user)
    await photosStep(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.NID_TAKEN)
    expect(screen.getByRole('heading', { name: en.register.photos.heading })).toBeInTheDocument()
    expect(screen.getByLabelText(en.register.photos.pin)).toHaveValue('')
    expect(screen.getByLabelText(en.register.photos.confirmPin)).toHaveValue('')
  })

  it('the registration token never touches localStorage or sessionStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { user } = visit()
    await phoneStep(user)
    await otpStep(user)
    await identityStep(user)
    await photosStep(user)
    await screen.findByText(en.kyc.pending.title)
    expect(completes[0].auth).toBe(`Bearer ${TOKEN}`) // the token really was used
    for (const [key, value] of setItem.mock.calls) {
      expect(`${key}=${value}`).not.toContain(TOKEN)
    }
    for (const storage of [localStorage, sessionStorage]) {
      expect(JSON.stringify({ ...storage })).not.toContain(TOKEN)
    }
    expect(sessionStorage.length).toBe(0)
  })

  it('Back from step 1 goes to /login; "Log in" links there too', async () => {
    const { router, user } = visit()
    expect(within(screen.getByRole('main')).getByRole('link', { name: en.register.login })).toHaveAttribute('href', '/login')
    await user.click(screen.getByRole('button', { name: en.common.back }))
    expect(router.state.location.pathname).toBe('/login')
  })

  it('renders in Bangla', async () => {
    const { useLanguage } = await import('../../../stores/language')
    const bn = (await import('../../../i18n/bn.json')).default
    act(() => useLanguage.getState().setLang('bn'))
    try {
      visit()
      expect(screen.getByRole('heading', { name: bn.register.phone.heading })).toBeInTheDocument()
    } finally {
      act(() => useLanguage.getState().setLang('en'))
      localStorage.clear()
    }
  })
})
