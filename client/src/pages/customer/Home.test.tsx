import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PublicUser } from '../../api/types'
import en from '../../i18n/en.json'
import { useSession } from '../../stores/session'
import { renderRoutes } from '../../test/render'
import { apiError, server, testUser } from '../../test/server'

let historyQueries: URLSearchParams[]

const signIn = (user: Partial<PublicUser> = {}) => useSession.getState().signIn({ user: testUser(user), accessToken: 't' })

beforeEach(() => {
  historyQueries = []
  server.use(
    http.get('/api/v1/me', () =>
      HttpResponse.json({
        success: true,
        data: { user: useSession.getState().user, wallet: { id: 'w1', type: 'CUSTOMER', balance: '1000000' } },
      }),
    ),
    http.get('/api/v1/transactions', ({ request }) => {
      historyQueries.push(new URL(request.url).searchParams)
      return HttpResponse.json({
        success: true,
        data: {
          items: [
            {
              trxId: 'PP7K2M9QXA',
              type: 'SEND_MONEY',
              direction: 'OUT',
              amount: '50500',
              counterparty: { name: 'Karim H***', phone: '01800000003', role: 'CUSTOMER' },
              balanceAfter: '949500',
              createdAt: '2026-11-25T04:12:09.512Z',
            },
            {
              trxId: 'PPM3W8R2NE',
              type: 'CASH_IN',
              direction: 'IN',
              amount: '1000000',
              counterparty: { name: 'Demo A***', phone: '01800000004', role: 'AGENT' },
              balanceAfter: '1000000',
              createdAt: '2026-11-24T10:03:41.118Z',
            },
          ],
          nextCursor: '17',
        },
      })
    }),
  )
})

describe('customer Home', () => {
  it('hides the balance until tapped', async () => {
    signIn()
    const { user } = renderRoutes('/')
    const show = await screen.findByRole('button', { name: en.home.showBalance })
    expect(screen.queryByText('৳10,000.00')).not.toBeInTheDocument()
    await user.click(show)
    expect(await screen.findByText('৳10,000.00')).toBeInTheDocument()
  })

  it('a PENDING_KYC customer sees the banner and disabled (not hidden) money actions', async () => {
    signIn({ status: 'PENDING_KYC', kycStatus: 'PENDING' })
    renderRoutes('/')
    expect(await screen.findByText(en.kyc.pending.title)).toBeInTheDocument()
    for (const flow of ['SEND_MONEY', 'CASH_OUT', 'PAYMENT'] as const) {
      expect(screen.getByRole('button', { name: en.flows[flow].title })).toBeDisabled()
    }
  })

  it('an ACTIVE customer opens Send Money from the grid', async () => {
    signIn()
    const { user, router } = renderRoutes('/')
    await user.click(await screen.findByRole('button', { name: en.flows.SEND_MONEY.title }))
    expect(router.state.location.pathname).toBe('/send-money')
  })

  it('lists the 5 most recent items, formatted, money out in text-danger with U+2212', async () => {
    signIn()
    renderRoutes('/')
    const out = await screen.findByText('−৳505.00')
    expect(out).toHaveClass('text-danger')
    expect(screen.getByText('+৳10,000.00')).toHaveClass('text-success-dark')
    expect(screen.getByText('Karim H***')).toBeInTheDocument()
    expect(historyQueries[0].get('limit')).toBe('5')
  })

  it('no history yet → the empty state', async () => {
    server.use(http.get('/api/v1/transactions', () => HttpResponse.json({ success: true, data: { items: [], nextCursor: null } })))
    signIn()
    renderRoutes('/')
    expect(await screen.findByText(en.home.empty)).toBeInTheDocument()
  })

  it('a KYC approval seen by /me (ACTIVE) enables Send Money without a new login', async () => {
    let answerMe = () => {}
    const meHeld = new Promise<void>((resolve) => (answerMe = resolve))
    server.use(
      http.get('/api/v1/me', async () => {
        await meHeld
        return HttpResponse.json({
          success: true,
          data: { user: testUser({ status: 'ACTIVE', kycStatus: 'APPROVED' }), wallet: { id: 'w1', type: 'CUSTOMER', balance: '0' } },
        })
      }),
    )
    signIn({ status: 'PENDING_KYC', kycStatus: 'PENDING' })
    renderRoutes('/')
    const send = await screen.findByRole('button', { name: en.flows.SEND_MONEY.title })
    expect(send).toBeDisabled() // the store's PENDING_KYC, before /me answers
    answerMe()
    await waitFor(() => expect(send).toBeEnabled())
    expect(screen.queryByText(en.kyc.pending.title)).not.toBeInTheDocument()
    expect(useSession.getState().user?.status).toBe('ACTIVE')
  })

  it('a failed load shows the translated error for the balance and the list, not a blank page', async () => {
    const limited = () => HttpResponse.json(apiError('RATE_LIMITED'), { status: 429 })
    server.use(http.get('/api/v1/me', limited), http.get('/api/v1/transactions', limited))
    signIn()
    const { user } = renderRoutes('/')
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual([en.errors.RATE_LIMITED, en.errors.RATE_LIMITED]))
    await user.click(screen.getByRole('button', { name: en.home.showBalance }))
    expect(screen.queryByText(/৳\d/)).not.toBeInTheDocument() // no amount is made up
  })
})
