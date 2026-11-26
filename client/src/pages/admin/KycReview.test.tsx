import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KycDetail } from '../../api/admin'
import en from '../../i18n/en.json'
import { useSession } from '../../stores/session'
import { adminUser, kycDetail, SUBMISSION_ID } from '../../test/admin'
import { renderPage } from '../../test/render'
import { apiError, server } from '../../test/server'

const PATH = `/admin/kyc/${SUBMISSION_ID}`
const DETAIL_KEY = ['admin', 'kyc', 'detail', SUBMISSION_ID]

let detailCalls: number
let detail: (n: number) => KycDetail
let patches: unknown[]
let patchAnswer: () => Response

const approved = () =>
  HttpResponse.json({
    success: true,
    data: { id: SUBMISSION_ID, status: 'APPROVED', reviewedAt: '2026-11-26T06:00:00.000Z', reason: null, user: { id: 'u', status: 'ACTIVE' } },
  })

beforeEach(() => {
  detailCalls = 0
  patches = []
  detail = (n) => kycDetail({}, n)
  patchAnswer = approved
  useSession.getState().signIn({ user: adminUser(), accessToken: 't' })
  server.use(
    http.get(`/api/v1/admin/kyc/${SUBMISSION_ID}`, () => {
      detailCalls++
      return HttpResponse.json({ success: true, data: detail(detailCalls) })
    }),
    http.patch(`/api/v1/admin/kyc/${SUBMISSION_ID}`, async ({ request }) => {
      patches.push(await request.json())
      return patchAnswer()
    }),
  )
})

afterEach(() => vi.useRealTimers())

const dialog = () => screen.getByRole('dialog')

describe('KYC review', () => {
  it('shows the full NID (font-amount), date of birth and age, role, shop and the 3 signed images', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-27T06:00:00Z'))
    await renderPage(PATH)
    expect(await screen.findByText('9000000006')).toHaveClass('font-amount')
    expect(screen.getByRole('heading', { level: 2, name: 'Jamal Uddin' })).toBeInTheDocument()
    expect(screen.getByText(/15 Jan 1990/)).toBeInTheDocument()
    expect(screen.getByText(/36 years old/)).toBeInTheDocument()
    expect(screen.getByText(en.roles.AGENT)).toBeInTheDocument()
    expect(screen.getByText('Jamal Store')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: en.admin.kyc.nidFront })).toHaveAttribute('src', kycDetail({}, 1).images.nidFront)
    expect(screen.getByRole('img', { name: en.admin.kyc.nidBack })).toHaveAttribute('src', kycDetail({}, 1).images.nidBack)
    expect(screen.getByRole('img', { name: en.admin.kyc.selfie })).toHaveAttribute('src', kycDetail({}, 1).images.selfie)
  })

  it('the 3 images are one list: side by side from lg, stacked below', async () => {
    await renderPage(PATH)
    const images = await screen.findByRole('list', { name: en.admin.kyc.documents })
    expect(within(images).getAllByRole('listitem')).toHaveLength(3)
    expect(images).toHaveClass('lg:grid-cols-3')
  })

  it('an image opens full size in a dialog', async () => {
    const { user } = await renderPage(PATH)
    await user.click(await screen.findByRole('button', { name: `Open ${en.admin.kyc.selfie} full size` }))
    expect(within(dialog()).getByRole('img', { name: en.admin.kyc.selfie })).toHaveAttribute('src', kycDetail({}, 1).images.selfie)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('an image that fails (link expired) refetches the detail once and retries with the new links; a second failure does not loop', async () => {
    await renderPage(PATH)
    fireEvent.error(await screen.findByRole('img', { name: en.admin.kyc.nidFront }))
    // The other two failing at once (the same expired batch) don't add refetches.
    fireEvent.error(screen.getByRole('img', { name: en.admin.kyc.selfie }))
    await waitFor(() =>
      expect(screen.getByRole('img', { name: en.admin.kyc.nidFront })).toHaveAttribute('src', kycDetail({}, 2).images.nidFront),
    )
    expect(screen.getByRole('img', { name: en.admin.kyc.selfie })).toHaveAttribute('src', kycDetail({}, 2).images.selfie)
    expect(detailCalls).toBe(2)
    // Failing again with the fresh links: a message, no third request.
    fireEvent.error(screen.getByRole('img', { name: en.admin.kyc.nidFront }))
    expect(await screen.findByText(en.admin.kyc.imageFailed)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(detailCalls).toBe(2)
  })

  it('earlier submissions show with their reasons', async () => {
    detail = (n) =>
      kycDetail(
        { history: [{ id: 'old', status: 'REJECTED', submittedAt: '2026-11-20T04:00:00.000Z', reason: 'The NID photo is blurry. Please retake it in good light.' }] },
        n,
      )
    await renderPage(PATH)
    const earlier = await screen.findByRole('region', { name: en.admin.kyc.earlier })
    expect(within(earlier).getByText(en.kycStatus.REJECTED)).toBeInTheDocument()
    expect(within(earlier).getByText(/The NID photo is blurry/)).toBeInTheDocument()
  })

  it('approve: a dialog naming the person, buttons disabled while sending, the right body, a toast and a refetch', async () => {
    let release!: () => void
    patchAnswer = () => approved()
    server.use(
      http.patch(`/api/v1/admin/kyc/${SUBMISSION_ID}`, async ({ request }) => {
        patches.push(await request.json())
        await new Promise<void>((r) => (release = r))
        return patchAnswer()
      }),
    )
    const { user } = await renderPage(PATH)
    await user.click(await screen.findByRole('button', { name: en.admin.kyc.approve }))
    expect(dialog()).toHaveAccessibleName('Approve Jamal Uddin?')
    await user.click(within(dialog()).getByRole('button', { name: en.admin.kyc.approve }))
    await waitFor(() => expect(patches).toEqual([{ decision: 'APPROVE' }]))
    expect(within(dialog()).getByRole('button', { name: en.admin.kyc.approve })).toBeDisabled()
    expect(within(dialog()).getByRole('button', { name: en.common.cancel })).toBeDisabled()
    detail = (n) => kycDetail({ status: 'APPROVED', reviewedBy: { id: 'a', name: 'Demo Admin' }, reviewedAt: '2026-11-26T06:00:00.000Z' }, n)
    release()
    expect(await screen.findByText('Jamal Uddin is approved.')).toBeInTheDocument()
    await waitFor(() => expect(detailCalls).toBe(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByText(en.admin.kyc.reviewedNote)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.admin.kyc.approve })).not.toBeInTheDocument()
  })

  it('reject is blocked under 5 characters; a quick reason fills it; the body has the reason; then a refetch', async () => {
    const { user } = await renderPage(PATH)
    await user.click(await screen.findByRole('button', { name: en.admin.kyc.reject }))
    expect(dialog()).toHaveAccessibleName('Reject Jamal Uddin?')
    const confirm = within(dialog()).getByRole('button', { name: en.admin.kyc.reject })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog()).getByRole('textbox', { name: en.admin.reason.label }), 'Blur')
    expect(confirm).toBeDisabled()
    await user.click(within(dialog()).getByRole('button', { name: en.admin.kyc.quick.blurry }))
    expect(within(dialog()).getByRole('textbox', { name: en.admin.reason.label })).toHaveValue(en.admin.kyc.quick.blurryText)
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    await waitFor(() => expect(patches).toEqual([{ decision: 'REJECT', reason: en.admin.kyc.quick.blurryText }]))
    await waitFor(() => expect(detailCalls).toBe(2))
  })

  it.each(['KYC_ALREADY_REVIEWED', 'KYC_NOT_LATEST', 'USER_STATUS_CHANGED'] as const)('409 %s → the translated toast and a refetch', async (code) => {
    patchAnswer = () => HttpResponse.json(apiError(code), { status: 409 })
    const { user } = await renderPage(PATH)
    await user.click(await screen.findByRole('button', { name: en.admin.kyc.approve }))
    await user.click(within(dialog()).getByRole('button', { name: en.admin.kyc.approve }))
    expect(await screen.findByText(en.errors[code])).toBeInTheDocument()
    await waitFor(() => expect(detailCalls).toBe(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('no Approve or Reject on a reviewed submission (who reviewed it shows instead)', async () => {
    detail = (n) =>
      kycDetail({ status: 'REJECTED', reason: 'Selfie mismatch', reviewedBy: { id: 'a', name: 'Demo Admin' }, reviewedAt: '2026-11-26T06:00:00.000Z' }, n)
    await renderPage(PATH)
    expect(await screen.findByText(en.admin.kyc.reviewedNote)).toBeInTheDocument()
    expect(screen.getByText(/Reviewed by Demo Admin/)).toBeInTheDocument()
    expect(screen.getByText(/Selfie mismatch/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.admin.kyc.approve })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.admin.kyc.reject })).not.toBeInTheDocument()
  })

  it('no Approve or Reject on a PENDING submission that is not the latest', async () => {
    detail = (n) => kycDetail({ isLatest: false }, n)
    await renderPage(PATH)
    expect(await screen.findByText(en.admin.kyc.notLatestNote)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.admin.kyc.approve })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.admin.kyc.reject })).not.toBeInTheDocument()
  })

  it('the detail (full NID, links) is gone from the cache after leaving the page, and never in storage', async () => {
    const { user, queryClient } = await renderPage(PATH)
    await screen.findByText('9000000006')
    const query = queryClient.getQueryCache().find({ queryKey: DETAIL_KEY })
    expect(query?.options).toMatchObject({ gcTime: 0, staleTime: 0 })
    await user.click(screen.getByRole('link', { name: en.admin.kyc.back }))
    await waitFor(() => expect(queryClient.getQueryCache().find({ queryKey: DETAIL_KEY })).toBeUndefined())
    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })
    expect(stored).not.toContain('9000000006')
    expect(stored).not.toContain('sig=')
  })

  it('an unknown submission → the translated error', async () => {
    server.use(http.get(`/api/v1/admin/kyc/${SUBMISSION_ID}`, () => HttpResponse.json(apiError('KYC_NOT_FOUND'), { status: 404 })))
    await renderPage(PATH)
    expect(await screen.findByText(en.errors.KYC_NOT_FOUND)).toBeInTheDocument()
  })
})
