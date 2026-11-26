import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryItem } from '../../api/types'
import en from '../../i18n/en.json'
import { useSession } from '../../stores/session'
import { renderRoutes } from '../../test/render'
import { apiError, server, testUser } from '../../test/server'

/** A whole line of text, even when part of it (the name) is its own element. */
const line = (text: string) => (_: string, el: Element | null) => el?.tagName === 'P' && el.textContent === text

const item = (trxId: string, overrides: Partial<HistoryItem> = {}): HistoryItem => ({
  trxId,
  type: 'SEND_MONEY',
  direction: 'OUT',
  amount: '50500',
  counterparty: { name: 'Karim H***', phone: '01800000003', role: 'CUSTOMER' },
  balanceAfter: '949500',
  createdAt: '2026-11-25T04:12:09.512Z',
  ...overrides,
})

const PAGE_1 = [
  item('PP7K2M9QXA'),
  item('PPM3W8R2NE', {
    type: 'CASH_IN',
    direction: 'IN',
    amount: '1000000',
    counterparty: { name: 'Demo A***', phone: '01800000004', role: 'AGENT' },
  }),
]
const PAGE_2 = [item('PPA2B3C4DE', { counterparty: { name: 'Demo Store', phone: '01800000005', role: 'MERCHANT' }, type: 'PAYMENT' })]

let queries: URLSearchParams[]

beforeEach(() => {
  queries = []
  useSession.getState().signIn({ user: testUser(), accessToken: 't' })
  server.use(
    http.get('/api/v1/transactions', ({ request }) => {
      const params = new URL(request.url).searchParams
      queries.push(params)
      const data = params.get('cursor') === '17' ? { items: PAGE_2, nextCursor: null } : { items: PAGE_1, nextCursor: '17' }
      return HttpResponse.json({ success: true, data })
    }),
  )
})

/** Every receipt link on the page, by trxId. */
const rowIds = () =>
  screen
    .getAllByRole('link')
    .map((a) => a.getAttribute('href') ?? '')
    .filter((href) => href.startsWith('/transactions/'))
    .map((href) => href.slice('/transactions/'.length))

describe('History', () => {
  it('pages on nextCursor until it is null, with no duplicate rows', async () => {
    const { user } = renderRoutes('/history')
    expect(await screen.findByText('Karim H***')).toBeInTheDocument()
    expect(rowIds()).toEqual(['PP7K2M9QXA', 'PPM3W8R2NE'])

    await user.click(screen.getByRole('button', { name: en.history.loadMore }))
    expect(await screen.findByText('Demo Store')).toBeInTheDocument()
    expect(rowIds()).toEqual(['PP7K2M9QXA', 'PPM3W8R2NE', 'PPA2B3C4DE'])
    expect(queries.map((q) => q.get('cursor'))).toEqual([null, '17'])
    // The last page: nothing more to load.
    expect(screen.queryByRole('button', { name: en.history.loadMore })).not.toBeInTheDocument()
  })

  it('shows the sign and colour: money out −৳ in text-danger, money in +৳ in text-success-dark', async () => {
    const { router } = renderRoutes('/history')
    expect(await screen.findByText('−৳505.00')).toHaveClass('text-danger')
    expect(router.state.location.pathname).toBe('/history')
    expect(screen.getByRole('heading', { level: 1, name: en.nav.history })).toBeInTheDocument()
    expect(screen.getByText('+৳10,000.00')).toHaveClass('text-success-dark')
    expect(screen.getAllByText(new RegExp(en.flows.SEND_MONEY.title)).length).toBeGreaterThan(0)
  })

  it('the type filter sends type=CASH_OUT, from the first page again', async () => {
    const { user } = renderRoutes('/history')
    await screen.findByText('Karim H***')
    await user.click(screen.getByRole('radio', { name: en.flows.CASH_OUT.title }))
    expect(screen.getByRole('radio', { name: en.flows.CASH_OUT.title })).toBeChecked()
    await screen.findByText('Karim H***')
    const last = queries.at(-1)!
    expect(last.get('type')).toBe('CASH_OUT')
    expect(last.get('cursor')).toBeNull()
  })

  it.each([
    ['CUSTOMER', ['SEND_MONEY', 'CASH_OUT', 'PAYMENT', 'CASH_IN']],
    ['AGENT', ['CASH_IN', 'CASH_OUT', 'FLOAT_TOPUP']],
    ['MERCHANT', ['PAYMENT']],
  ] as const)('the type filter offers a %s only the types it can have', async (role, types) => {
    useSession.getState().signIn({ user: testUser({ role }), accessToken: 't' })
    renderRoutes('/history')
    // Chips: one radio per type, "All types" first and chosen.
    const options = within(await screen.findByRole('group', { name: en.history.type })).getAllByRole('radio')
    expect(options.map((o) => (o as HTMLInputElement).value)).toEqual(['', ...types])
    expect(options.map((o) => o.closest('label')?.textContent)).toEqual([en.history.all, ...types.map((type) => en.flows[type].title)])
    expect(options[0]).toBeChecked()
  })

  it('the date filter sends from and to as YYYY-MM-DD', async () => {
    renderRoutes('/history')
    await screen.findByText('Karim H***')
    fireEvent.change(screen.getByLabelText(en.history.from), { target: { value: '2026-11-01' } })
    fireEvent.change(screen.getByLabelText(en.history.to), { target: { value: '2026-11-25' } })
    await screen.findByText('Karim H***')
    // Exactly these params: both dates as YYYY-MM-DD, no type ("All types"), no cursor (page 1). The from-only request is
    // still in flight when this one goes, so the arrival order isn't fixed: look for it rather than take the last one.
    await waitFor(() => expect(queries.map(String)).toContain('from=2026-11-01&to=2026-11-25'))
  })

  it('no transactions → the empty state', async () => {
    server.use(http.get('/api/v1/transactions', () => HttpResponse.json({ success: true, data: { items: [], nextCursor: null } })))
    renderRoutes('/history')
    expect(await screen.findByText(en.history.empty)).toBeInTheDocument()
  })

  it('tapping a row opens its receipt', async () => {
    server.use(
      http.get('/api/v1/transactions/:trxId', ({ params }) =>
        HttpResponse.json({
          success: true,
          data: {
            trxId: params.trxId,
            type: 'SEND_MONEY',
            status: 'COMPLETED',
            amount: '50000',
            fee: '500',
            note: null,
            createdAt: '2026-11-25T04:12:09.512Z',
            from: { name: 'Test U***', phone: '01700000000', role: 'CUSTOMER' },
            to: { name: 'Karim H***', phone: '01800000003', role: 'CUSTOMER' },
            mine: { amount: '-50500', balanceAfter: '949500' },
          },
        }),
      ),
    )
    const { user, router } = renderRoutes('/history')
    await user.click(await screen.findByText('Karim H***'))
    expect(router.state.location.pathname).toBe('/transactions/PP7K2M9QXA')
    expect(await screen.findByText('PP7K2M9QXA')).toBeInTheDocument()
    // The signed mine.amount, through formatTaka: out → U+2212.
    expect(screen.getByText('−৳505.00')).toHaveClass('text-danger')
    expect(screen.getByText('৳9,495.00')).toBeInTheDocument()
  })
})

describe('row times', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('are relative, by the Dhaka day: the time today, then "Yesterday", then the date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-25T10:00:00Z')) // 16:00 in Dhaka
    const items = [
      item('PP7K2M9QXA', { createdAt: '2026-11-25T01:42:00Z' }), // 07:42 today
      item('PPM3W8R2NE', { createdAt: '2026-11-24T17:59:00Z' }), // 23:59 yesterday (but the 24th in UTC too)
      item('PPA2B3C4DE', { createdAt: '2026-11-23T17:59:00Z' }), // 23:59 on the 23rd
    ]
    server.use(http.get('/api/v1/transactions', () => HttpResponse.json({ success: true, data: { items, nextCursor: null } })))
    renderRoutes('/history')
    expect(await screen.findByText(`${en.flows.SEND_MONEY.title} · 7:42 am`)).toBeInTheDocument()
    expect(screen.getByText(`${en.flows.SEND_MONEY.title} · Yesterday`)).toBeInTheDocument()
    expect(screen.getByText(`${en.flows.SEND_MONEY.title} · 23 Nov`)).toBeInTheDocument()
  })
})

describe('Receipt', () => {
  const receiptOf = (overrides: Record<string, unknown> = {}) => ({
    trxId: 'PP7K2M9QXA',
    type: 'SEND_MONEY',
    status: 'COMPLETED',
    amount: '50000',
    fee: '500',
    note: null,
    createdAt: '2026-11-25T04:12:09.512Z',
    from: { name: 'Test U***', phone: '01700000000', role: 'CUSTOMER' },
    to: { name: 'Karim H***', phone: '01800000003', role: 'CUSTOMER' },
    mine: { amount: '-50500', balanceAfter: '949500' },
    ...overrides,
  })
  const value = (label: string) => screen.getByText(label).nextElementSibling

  it('the same receipt card as the Sent screen: to whom, the amount, TrxID, time, fee, total paid, a stitched tear line, the new balance', async () => {
    server.use(http.get('/api/v1/transactions/:trxId', () => HttpResponse.json({ success: true, data: receiptOf() })))
    renderRoutes('/transactions/PP7K2M9QXA')
    expect(await screen.findByRole('heading', { name: en.flows.SEND_MONEY.title })).toBeInTheDocument()
    expect(screen.getByText(line('to Karim H*** · 01800000003'))).toBeInTheDocument()
    expect(screen.getByText('৳500.00')).toHaveClass('font-amount')
    expect(value(en.transfer.trxId)).toHaveTextContent('PP7K2M9QXA')
    expect(value(en.transfer.time)).toHaveTextContent('25 Nov 2026, 10:12 am')
    expect(value(en.transfer.fee)).toHaveTextContent('৳5.00')
    expect(value(en.transfer.totalPaid)).toHaveTextContent('−৳505.00')
    expect(document.querySelector('svg line[stroke-dasharray="7 9"]')).not.toBeNull()
    expect(value(en.transfer.balanceAfter)).toHaveTextContent('৳9,495.00')
    expect(screen.getByRole('button', { name: en.transfer.share })).toBeInTheDocument()
  })

  it('money in: "Received" and a green +amount, from whom', async () => {
    const data = receiptOf({
      type: 'CASH_IN',
      amount: '1000000',
      fee: '0',
      from: { name: 'Demo A***', phone: '01800000004', role: 'AGENT' },
      to: { name: 'Test U***', phone: '01700000000', role: 'CUSTOMER' },
      mine: { amount: '1000000', balanceAfter: '1949500' },
    })
    server.use(http.get('/api/v1/transactions/:trxId', () => HttpResponse.json({ success: true, data })))
    renderRoutes('/transactions/PP7K2M9QXA')
    expect(await screen.findByText(line('from Demo A*** · 01800000004'))).toBeInTheDocument()
    expect(value(en.transfer.received)).toHaveTextContent('+৳10,000.00')
    expect(screen.getByText('+৳10,000.00')).toHaveClass('text-success-dark')
    expect(screen.queryByText(en.transfer.totalPaid)).not.toBeInTheDocument()
  })

  it("someone else's (or no such) transaction: the 404 → a translated not-found page, asked once (no retry)", async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/transactions/:trxId', () => {
        calls += 1
        return HttpResponse.json(apiError('TRANSACTION_NOT_FOUND'), { status: 404 })
      }),
    )
    renderRoutes('/transactions/PPZZZZZZZZ')
    expect(await screen.findByText(en.receipt.notFound)).toBeInTheDocument()
    expect(screen.getByText(en.receipt.notFoundBody)).toBeInTheDocument()
    expect(calls).toBe(1)
  })
})

describe('History errors', () => {
  it('a failed first page shows the translated error instead of the list', async () => {
    server.use(http.get('/api/v1/transactions', () => HttpResponse.json(apiError('RATE_LIMITED'), { status: 429 })))
    renderRoutes('/history')
    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.RATE_LIMITED)
    expect(screen.queryByText(en.history.empty)).not.toBeInTheDocument()
  })
})
