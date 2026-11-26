import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PublicUser } from '../../api/types'
import en from '../../i18n/en.json'
import { useSession } from '../../stores/session'
import { renderPage, renderRoutes } from '../../test/render'
import { apiError, readMultipart, server, testUser, type SentFile } from '../../test/server'

const REASON = 'The NID photo is blurry. Please retake it in good light.'

let calls: string[]
let posts: Array<{ fields: Record<string, string>; files: Record<string, SentFile> }>
let postAnswer: [number, unknown]

const signIn = (user: Partial<PublicUser>) => useSession.getState().signIn({ user: testUser(user), accessToken: 't' })
const rejected = { status: 'REJECTED', kycStatus: 'REJECTED' } as const
const pendingUser = testUser({ status: 'PENDING_KYC', kycStatus: 'PENDING' })

beforeEach(() => {
  calls = []
  posts = []
  postAnswer = [
    201,
    { success: true, data: { user: pendingUser, kyc: { status: 'PENDING', reason: null, submittedAt: '2026-11-27T06:00:00.000Z', reviewedAt: null } } },
  ]
  // After a successful resubmit the server answers with the new state, as the real one would.
  let resubmitted = false
  server.use(
    http.get('/api/v1/me', () => {
      calls.push('GET /me')
      const user = resubmitted ? pendingUser : useSession.getState().user
      return HttpResponse.json({ success: true, data: { user, wallet: { id: 'w1', type: 'CUSTOMER', balance: '0' } } })
    }),
    http.get('/api/v1/kyc', () => {
      calls.push('GET /kyc')
      return HttpResponse.json({
        success: true,
        data: resubmitted
          ? { status: 'PENDING', reason: null, submittedAt: '2026-11-27T06:00:00.000Z', reviewedAt: null }
          : { status: 'REJECTED', reason: REASON, submittedAt: '2026-11-19T08:00:00.000Z', reviewedAt: '2026-11-20T08:00:00.000Z' },
      })
    }),
    http.post('/api/v1/kyc/resubmit', async ({ request }) => {
      calls.push('POST /kyc/resubmit')
      posts.push(await readMultipart(request))
      if (postAnswer[0] === 201) resubmitted = true
      return HttpResponse.json(postAnswer[1] as object, { status: postAnswer[0] })
    }),
  )
})

const photo = (name: string) => new File([new Uint8Array(1000)], name, { type: 'image/jpeg' })
const afterPost = () => calls.slice(calls.indexOf('POST /kyc/resubmit') + 1)

describe('the KYC banner on home', () => {
  it('a REJECTED customer sees the reason and "Resubmit documents"; the money actions stay disabled, not hidden', async () => {
    signIn(rejected)
    renderRoutes('/')
    expect(await screen.findByText(en.kyc.rejected.title)).toBeInTheDocument()
    expect(await screen.findByText(REASON)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: en.kyc.resubmit.button })).toHaveAttribute('href', '/kyc/resubmit')
    for (const name of [en.flows.SEND_MONEY.title, en.flows.CASH_OUT.title, en.flows.PAYMENT.title]) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
  })

  it.each(['AGENT', 'MERCHANT'] as const)('a REJECTED %s gets the reason and the button too', async (role) => {
    signIn({ ...rejected, role })
    renderRoutes('/')
    expect(await screen.findByText(REASON)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: en.kyc.resubmit.button })).toBeInTheDocument()
  })

  it('PENDING_KYC: the "under review" banner and disabled money actions, no reason, no button', async () => {
    signIn({ status: 'PENDING_KYC', kycStatus: 'PENDING' })
    renderRoutes('/')
    expect(await screen.findByText(en.kyc.pending.title)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.flows.SEND_MONEY.title })).toBeDisabled()
    expect(screen.queryByRole('link', { name: en.kyc.resubmit.button })).not.toBeInTheDocument()
    expect(screen.queryByText(REASON)).not.toBeInTheDocument()
  })

  it('ACTIVE: no banner and no button', async () => {
    signIn({ status: 'ACTIVE' })
    renderRoutes('/')
    expect(await screen.findByRole('button', { name: en.flows.SEND_MONEY.title })).toBeEnabled()
    expect(screen.queryByText(en.kyc.rejected.title)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: en.kyc.resubmit.button })).not.toBeInTheDocument()
  })
})

describe('/kyc/resubmit', () => {
  it('the button opens the page: the demo warning and the 3 pickers from registration', async () => {
    signIn(rejected)
    const { router, user } = renderRoutes('/')
    await user.click(await screen.findByRole('link', { name: en.kyc.resubmit.button }))
    expect(await screen.findByRole('heading', { level: 1, name: en.kyc.resubmit.title })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/kyc/resubmit')
    expect(screen.getByText(en.kyc.demo)).toBeInTheDocument()
    for (const label of [en.register.photos.nidFront, en.register.photos.nidBack, en.register.photos.selfie]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
  })

  it('needs all 3 images: no request until each one is picked', async () => {
    signIn(rejected)
    const { user } = await renderPage('/kyc/resubmit')
    await user.upload(await screen.findByLabelText(en.register.photos.nidFront), photo('front.jpg'))
    await user.click(screen.getByRole('button', { name: en.kyc.resubmit.submit }))
    expect(await screen.findAllByText(en.validation.photo)).toHaveLength(2)
    expect(posts).toHaveLength(0)
  })

  it('sends ONE multipart request with the 3 files; then home says "under review", with /me and /kyc fetched again', async () => {
    signIn(rejected)
    const { router, user } = renderRoutes('/')
    await screen.findByText(REASON)
    await user.click(screen.getByRole('link', { name: en.kyc.resubmit.button }))
    await user.upload(await screen.findByLabelText(en.register.photos.nidFront), photo('front.jpg'))
    await user.upload(screen.getByLabelText(en.register.photos.nidBack), photo('back.jpg'))
    await user.upload(screen.getByLabelText(en.register.photos.selfie), photo('selfie.jpg'))
    await user.click(screen.getByRole('button', { name: en.kyc.resubmit.submit }))

    expect(await screen.findByText(en.kyc.pending.title)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(posts).toHaveLength(1)
    expect(Object.keys(posts[0]!.files).sort()).toEqual(['nidBack', 'nidFront', 'selfie'])
    expect(posts[0]!.fields).toEqual({})
    for (const f of Object.values(posts[0]!.files)) expect(f.type).toBe('image/jpeg')
    await waitFor(() => expect(afterPost()).toEqual(expect.arrayContaining(['GET /me', 'GET /kyc'])))
    expect(useSession.getState().user?.status).toBe('PENDING_KYC')
    expect(screen.queryByText(en.kyc.rejected.title)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.flows.SEND_MONEY.title })).toBeDisabled()
  })

  it('a 409 shows the translated message and stays on the page', async () => {
    postAnswer = [409, apiError('KYC_RESUBMIT_NOT_ALLOWED')]
    signIn(rejected)
    const { router, user } = await renderPage('/kyc/resubmit')
    await user.upload(await screen.findByLabelText(en.register.photos.nidFront), photo('front.jpg'))
    await user.upload(screen.getByLabelText(en.register.photos.nidBack), photo('back.jpg'))
    await user.upload(screen.getByLabelText(en.register.photos.selfie), photo('selfie.jpg'))
    await user.click(screen.getByRole('button', { name: en.kyc.resubmit.submit }))
    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.KYC_RESUBMIT_NOT_ALLOWED)
    expect(router.state.location.pathname).toBe('/kyc/resubmit')
  })

  it('a user who is not REJECTED opening /kyc/resubmit lands on home', async () => {
    signIn({ status: 'PENDING_KYC', kycStatus: 'PENDING' })
    const { router } = renderRoutes('/kyc/resubmit')
    expect(await screen.findByText(en.kyc.pending.title)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })
})
