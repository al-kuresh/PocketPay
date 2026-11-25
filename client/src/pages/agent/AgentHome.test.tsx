import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { PublicUser } from '../../api/types'
import en from '../../i18n/en.json'
import { useSession } from '../../stores/session'
import { renderRoutes } from '../../test/render'
import { server, testUser } from '../../test/server'

const FLOW_TITLES = Object.values(en.flows).map((f) => f.title)

function signInAs(role: 'AGENT' | 'MERCHANT', user: Partial<PublicUser> = {}) {
  const overrides: Partial<PublicUser> =
    role === 'AGENT'
      ? { role, name: 'Demo Agent', phone: '01800000004' }
      : { role, name: 'Demo Owner', phone: '01800000005', shopName: 'Demo Store' }
  useSession.getState().signIn({ user: testUser({ ...overrides, ...user }), accessToken: 't' })
  server.use(
    http.get('/api/v1/me', () =>
      HttpResponse.json({ success: true, data: { user: useSession.getState().user, wallet: { id: 'w', type: role, balance: '5000000' } } }),
    ),
  )
}

describe('agent home', () => {
  it('shows the e-money balance, Cash In and History, and no Send Money', async () => {
    signInAs('AGENT')
    const { user } = renderRoutes('/')
    await user.click(await screen.findByRole('button', { name: en.home.showBalance }))
    expect(await screen.findByText('৳50,000.00')).toBeInTheDocument()
    expect(screen.getByText(en.home.eMoney)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.flows.CASH_IN.title })).toBeEnabled()
    expect(screen.getAllByRole('link', { name: en.nav.history }).length).toBeGreaterThan(0)
    for (const title of [en.flows.SEND_MONEY.title, en.flows.CASH_OUT.title, en.flows.PAYMENT.title]) {
      expect(screen.queryByRole('button', { name: title })).not.toBeInTheDocument()
    }
  })

  it('a received Cash Out shows the commission-included amount, as the API gives it', async () => {
    signInAs('AGENT')
    server.use(
      http.get('/api/v1/transactions', () =>
        HttpResponse.json({
          success: true,
          data: {
            items: [
              {
                trxId: 'PPQ7R8S9TU',
                type: 'CASH_OUT',
                direction: 'IN',
                amount: '100040',
                counterparty: { name: 'Rahim U***', phone: '01800000002', role: 'CUSTOMER' },
                balanceAfter: '5100040',
                createdAt: '2026-11-25T04:12:09.512Z',
              },
              {
                trxId: 'PPF1F2F3F4',
                type: 'FLOAT_TOPUP',
                direction: 'IN',
                amount: '5000000',
                counterparty: { name: 'PocketPay', phone: null, role: 'SYSTEM' },
                balanceAfter: '5000000',
                createdAt: '2026-11-24T04:12:09.512Z',
              },
            ],
            nextCursor: null,
          },
        }),
      ),
    )
    renderRoutes('/')
    expect(await screen.findByText('+৳1,000.40')).toHaveClass('text-success-dark')
    // A float top-up has a translated type label, not a raw i18n key.
    expect(screen.getByText(new RegExp(en.flows.FLOAT_TOPUP.title))).toBeInTheDocument()
  })

  it('Cash In opens the Cash In flow (the shared TransferFlow)', async () => {
    signInAs('AGENT')
    const { user, router } = renderRoutes('/')
    await user.click(await screen.findByRole('button', { name: en.flows.CASH_IN.title }))
    expect(router.state.location.pathname).toBe('/cash-in')
    expect(await screen.findByLabelText(en.flows.CASH_IN.receiver)).toBeInTheDocument()
  })

  it('a PENDING_KYC agent sees the banner and a disabled Cash In', async () => {
    signInAs('AGENT', { status: 'PENDING_KYC', kycStatus: 'PENDING' })
    renderRoutes('/')
    expect(await screen.findByText(en.kyc.pending.title)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.flows.CASH_IN.title })).toBeDisabled()
  })

  it('a CUSTOMER at /cash-in is sent to their home', async () => {
    useSession.getState().signIn({ user: testUser(), accessToken: 't' })
    const { router } = renderRoutes('/cash-in')
    expect(await screen.findByRole('button', { name: en.flows.SEND_MONEY.title })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })
})

describe('merchant home', () => {
  it('shows the balance, History and "your number for payments", and no money action', async () => {
    signInAs('MERCHANT')
    const { user } = renderRoutes('/')
    expect(await screen.findByText(en.merchant.yourNumber)).toBeInTheDocument()
    expect(screen.getByText('01800000005')).toHaveClass('tabular-nums')
    await user.click(screen.getByRole('button', { name: en.home.showBalance }))
    expect(await screen.findByText('৳50,000.00')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: en.nav.history }).length).toBeGreaterThan(0)
    for (const title of FLOW_TITLES) {
      expect(screen.queryByRole('button', { name: title })).not.toBeInTheDocument()
    }
  })
})
