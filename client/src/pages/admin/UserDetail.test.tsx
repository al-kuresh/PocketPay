import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AdminUserDetail } from '../../api/admin'
import en from '../../i18n/en.json'
import { useSession } from '../../stores/session'
import { adminUser, JAMAL_ID, SUBMISSION_ID, userDetail } from '../../test/admin'
import { renderPage } from '../../test/render'
import { apiError, server } from '../../test/server'

const PATH = `/admin/users/${JAMAL_ID}`
const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString()

let detailCalls: number
let detail: AdminUserDetail
let statusBodies: unknown[]
let statusAnswer: () => Response
let unlocks: number

beforeEach(() => {
  detailCalls = 0
  statusBodies = []
  unlocks = 0
  detail = userDetail()
  statusAnswer = () => HttpResponse.json({ success: true, data: { id: JAMAL_ID, status: 'FROZEN' } })
  useSession.getState().signIn({ user: adminUser(), accessToken: 't' })
  server.use(
    http.get(`/api/v1/admin/users/${JAMAL_ID}`, () => {
      detailCalls++
      return HttpResponse.json({ success: true, data: detail })
    }),
    http.patch(`/api/v1/admin/users/${JAMAL_ID}/status`, async ({ request }) => {
      statusBodies.push(await request.json())
      return statusAnswer()
    }),
    http.post(`/api/v1/admin/users/${JAMAL_ID}/unlock`, () => {
      unlocks++
      return HttpResponse.json({ success: true, data: { id: JAMAL_ID, unlocked: true } })
    }),
  )
})

const dialog = () => screen.getByRole('dialog')

describe('User detail', () => {
  it('shows the fields, the balance, the KYC status with a link to the review, and the recent audit rows', async () => {
    await renderPage(PATH)
    expect(await screen.findByRole('heading', { level: 2, name: 'Jamal Uddin' })).toBeInTheDocument()
    expect(screen.getByText('01800000006')).toBeInTheDocument()
    expect(screen.getByText('*******006')).toBeInTheDocument()
    expect(screen.queryByText('9000000006')).not.toBeInTheDocument() // the full NID is only on the KYC review
    expect(screen.getByText('৳12,345.50')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: en.admin.users.openReview })).toHaveAttribute('href', `/admin/kyc/${SUBMISSION_ID}`)
    const activity = screen.getByRole('region', { name: en.admin.users.activity })
    expect(within(activity).getByText(en.admin.audit.actions.KYC_APPROVED)).toBeInTheDocument()
  })

  it('freeze needs a reason of at least 5 characters and sends it; then a refetch', async () => {
    const { user } = await renderPage(PATH)
    await user.click(await screen.findByRole('button', { name: en.admin.users.freeze }))
    expect(dialog()).toHaveAccessibleName('Freeze Jamal Uddin?')
    const confirm = within(dialog()).getByRole('button', { name: en.admin.users.freeze })
    expect(confirm).toBeDisabled()
    const field = within(dialog()).getByRole('textbox', { name: en.admin.reason.label })
    await user.type(field, 'Scam')
    expect(confirm).toBeDisabled()
    expect(within(dialog()).getByText('4/200')).toBeInTheDocument()
    await user.type(field, ' report from a customer')
    await user.click(confirm)
    await waitFor(() => expect(statusBodies).toEqual([{ action: 'FREEZE', reason: 'Scam report from a customer' }]))
    expect(await screen.findByText('Jamal Uddin is frozen.')).toBeInTheDocument()
    await waitFor(() => expect(detailCalls).toBe(2))
  })

  it('a FROZEN user has Unfreeze (also with a reason), not Freeze', async () => {
    detail = userDetail({ status: 'FROZEN' })
    statusAnswer = () => HttpResponse.json({ success: true, data: { id: JAMAL_ID, status: 'ACTIVE' } })
    const { user } = await renderPage(PATH)
    await user.click(await screen.findByRole('button', { name: en.admin.users.unfreeze }))
    expect(screen.queryByRole('button', { name: en.admin.users.freeze })).not.toBeInTheDocument()
    await user.type(within(dialog()).getByRole('textbox', { name: en.admin.reason.label }), 'Checked with the user')
    await user.click(within(dialog()).getByRole('button', { name: en.admin.users.unfreeze }))
    await waitFor(() => expect(statusBodies).toEqual([{ action: 'UNFREEZE', reason: 'Checked with the user' }]))
  })

  it('a PENDING_KYC user, or an admin, has neither', async () => {
    detail = userDetail({ status: 'PENDING_KYC' })
    await renderPage(PATH)
    await screen.findByRole('heading', { level: 2, name: 'Jamal Uddin' })
    expect(screen.queryByRole('button', { name: en.admin.users.freeze })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.admin.users.unfreeze })).not.toBeInTheDocument()
  })

  it('an admin target: no actions at all', async () => {
    detail = userDetail({ role: 'ADMIN', lockedUntil: inAnHour(), balance: null, latestKyc: null })
    await renderPage(PATH)
    await screen.findByRole('heading', { level: 2, name: 'Jamal Uddin' })
    expect(screen.queryByRole('button', { name: en.admin.users.freeze })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.admin.users.unlock })).not.toBeInTheDocument()
  })

  it('409 USER_STATUS_CHANGED → the translated toast and a refetch', async () => {
    statusAnswer = () => HttpResponse.json(apiError('USER_STATUS_CHANGED', { status: 'FROZEN' }), { status: 409 })
    const { user } = await renderPage(PATH)
    await user.click(await screen.findByRole('button', { name: en.admin.users.freeze }))
    await user.type(within(dialog()).getByRole('textbox', { name: en.admin.reason.label }), 'Fraud report')
    await user.click(within(dialog()).getByRole('button', { name: en.admin.users.freeze }))
    expect(await screen.findByText(en.errors.USER_STATUS_CHANGED)).toBeInTheDocument()
    await waitFor(() => expect(detailCalls).toBe(2))
  })

  it('Clear PIN lock shows only while lockedUntil is in the future, and clears it', async () => {
    detail = userDetail({ lockedUntil: inAnHour(), failedPinAttempts: 3 })
    const { user } = await renderPage(PATH)
    await user.click(await screen.findByRole('button', { name: en.admin.users.unlock }))
    await waitFor(() => expect(unlocks).toBe(1))
    expect(await screen.findByText('PIN lock cleared. Jamal Uddin can log in again.')).toBeInTheDocument()
    await waitFor(() => expect(detailCalls).toBe(2))
  })

  it.each([
    ['an expired lock', () => new Date(Date.now() - 60 * 1000).toISOString()],
    ['no lock', () => null],
  ])('no Clear PIN lock with %s', async (_, lockedUntil) => {
    detail = userDetail({ lockedUntil: lockedUntil(), failedPinAttempts: 2 })
    await renderPage(PATH)
    await screen.findByRole('heading', { level: 2, name: 'Jamal Uddin' })
    expect(screen.queryByRole('button', { name: en.admin.users.unlock })).not.toBeInTheDocument()
  })
})
