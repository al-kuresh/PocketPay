import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../i18n/en.json'
import { useSession } from '../../stores/session'
import { renderPage, renderRoutes } from '../../test/render'
import { apiError, server, testUser } from '../../test/server'

type User = ReturnType<typeof renderRoutes>['user']
type FlowPath = 'send-money' | 'cash-out' | 'payment'

// design-ok: a UUID regex, not a CSS class
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const RAHIM = { name: 'Rahim U***', phone: '01800000002', role: 'CUSTOMER' }
const PEOPLE: Record<string, { name: string; role: string }> = {
  '01800000003': { name: 'Karim H***', role: 'CUSTOMER' },
  '01800000004': { name: 'Demo A***', role: 'AGENT' },
  '01800000005': { name: 'Demo Store', role: 'MERCHANT' },
}
const TYPE: Record<FlowPath, string> = { 'send-money': 'SEND_MONEY', 'cash-out': 'CASH_OUT', payment: 'PAYMENT' }

interface Sent {
  path: FlowPath
  key: string | null
  body: Record<string, unknown>
}
let posts: Sent[]
let previews: unknown[]
let lookups: string[]
/** What the next money POSTs answer, in order; when empty, a receipt (201, or 200 replayed for a key seen before). */
let answers: Array<'network' | [number, unknown]>

beforeEach(() => {
  posts = []
  previews = []
  lookups = []
  answers = []
  useSession.getState().signIn({ user: testUser({ name: 'Rahim Uddin', phone: '01800000002' }), accessToken: 't' })
  server.use(
    http.get('/api/v1/wallets/lookup', ({ request }) => {
      const phone = new URL(request.url).searchParams.get('phone') ?? ''
      lookups.push(phone)
      const who = PEOPLE[phone]
      return who
        ? HttpResponse.json({ success: true, data: who })
        : HttpResponse.json(apiError('RECEIVER_NOT_FOUND'), { status: 404 })
    }),
    http.post('/api/v1/transactions/preview', async ({ request }) => {
      const body = (await request.json()) as { type: string; receiverPhone: string; amount: string }
      previews.push(body)
      const fee = '500'
      return HttpResponse.json({
        success: true,
        data: {
          type: body.type,
          amount: body.amount,
          fee,
          total: (BigInt(body.amount) + BigInt(fee)).toString(),
          receiver: { phone: body.receiverPhone, ...PEOPLE[body.receiverPhone] },
        },
      })
    }),
    ...(['send-money', 'cash-out', 'payment'] as const).map((path) =>
      http.post(`/api/v1/transactions/${path}`, async ({ request }) => {
        const key = request.headers.get('Idempotency-Key')
        const body = (await request.json()) as Record<string, unknown>
        posts.push({ path, key, body })
        const answer = answers.shift()
        if (answer === 'network') return HttpResponse.error()
        if (answer) return HttpResponse.json(answer[1] as object, { status: answer[0] })
        const replayed = posts.filter((p) => p.key === key).length > 1
        const to = { phone: body.receiverPhone as string, ...PEOPLE[body.receiverPhone as string] }
        const receipt = {
          trxId: 'PP7K2M9QXA',
          type: TYPE[path],
          status: 'COMPLETED',
          amount: body.amount,
          fee: '500',
          note: null,
          createdAt: '2026-11-25T04:12:09.512Z',
          from: RAHIM,
          to,
          mine: { amount: `-${BigInt(body.amount as string) + 500n}`, balanceAfter: '949500' },
        }
        return HttpResponse.json({ success: true, data: { replayed, receipt } }, { status: replayed ? 200 : 201 })
      }),
    ),
  )
})

const receiverField = (label = en.flows.SEND_MONEY.receiver) => screen.getByLabelText(label)
const pinField = () => screen.queryByLabelText(en.transfer.pin)

/** Enter: phone (waits for the lookup's name), amount, Next. */
async function enterDetails(user: User, { phone = '01800000003', amount = '500', label = en.flows.SEND_MONEY.receiver } = {}) {
  await user.type(receiverField(label), phone)
  expect(await screen.findByText(PEOPLE[phone].name)).toBeInTheDocument()
  await user.type(screen.getByLabelText(en.transfer.amount), amount)
  await user.click(screen.getByRole('button', { name: en.transfer.next }))
}

/** Preview → Next → the PIN step. */
async function confirmPreview(user: User) {
  await screen.findByText(en.transfer.total)
  await user.click(screen.getByRole('button', { name: en.transfer.next }))
  expect(await screen.findByLabelText(en.transfer.pin)).toBeInTheDocument()
}

async function submitPin(user: User, button = en.transfer.confirm) {
  await user.type(pinField()!, '48213')
  await user.click(screen.getByRole('button', { name: button }))
}

describe('TransferFlow: Send Money', () => {
  it('happy path: lookup → preview → PIN → receipt, with the right request bodies and a UUID key', async () => {
    const { user, queryClient, router } = await renderPage('/send-money')
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await enterDetails(user)
    expect(lookups).toEqual(['01800000003']) // debounced: one lookup for the whole number, not one per digit
    expect(previews).toEqual([{ type: 'SEND_MONEY', receiverPhone: '01800000003', amount: '50000' }])

    // Preview: receiver, amount, fee, and the total
    expect(await screen.findByText('Karim H***')).toBeInTheDocument()
    expect(screen.getByText('৳500.00')).toBeInTheDocument()
    expect(screen.getByText('৳5.00')).toBeInTheDocument()
    expect(screen.getByText('৳505.00')).toBeInTheDocument()

    await confirmPreview(user)
    await submitPin(user)

    expect(await screen.findByText('PP7K2M9QXA')).toBeInTheDocument()
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('send-money')
    expect(posts[0].body).toEqual({ receiverPhone: '01800000003', amount: '50000', pin: '48213' })
    expect(posts[0].key).toMatch(UUID)

    // the receipt: my signed amount (money out), and the balance from mine.balanceAfter (/me says 0)
    const mine = screen.getByText('−৳505.00')
    expect(mine).toHaveClass('text-danger')
    expect(screen.getByText('৳9,495.00')).toBeInTheDocument()

    // the balance and the recent list are refetched
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['history'] })

    await user.click(screen.getByRole('button', { name: en.transfer.done }))
    expect(router.state.location.pathname).toBe('/')
  })

  it('Review focus #2: a network error, then "Try again" → the SAME key, and the (replayed) receipt shows', async () => {
    answers = ['network']
    const { user } = await renderPage('/send-money')
    await enterDetails(user)
    await confirmPreview(user)
    await submitPin(user)

    expect(await screen.findByText(en.errors.NETWORK_ERROR)).toBeInTheDocument()
    expect(pinField()).toHaveValue('') // the PIN is cleared after every submit
    await submitPin(user, en.transfer.tryAgain)

    expect(await screen.findByText('PP7K2M9QXA')).toBeInTheDocument()
    expect(posts).toHaveLength(2)
    expect(posts[1].key).toBe(posts[0].key)
    expect(posts[1].body).toEqual(posts[0].body)
  })

  it('Review focus #2: back to Enter, change the amount, confirm again → a DIFFERENT key', async () => {
    answers = ['network']
    const { user } = await renderPage('/send-money')
    await enterDetails(user)
    await confirmPreview(user)
    await submitPin(user)
    await screen.findByText(en.errors.NETWORK_ERROR)

    // back from the PIN step → Enter, with the values kept
    await user.click(screen.getByRole('button', { name: en.common.back }))
    expect(receiverField()).toHaveValue('01800000003')
    const amount = screen.getByLabelText(en.transfer.amount)
    expect(amount).toHaveValue('500')
    await user.clear(amount)
    await user.type(amount, '600')
    await user.click(screen.getByRole('button', { name: en.transfer.next }))
    await confirmPreview(user)
    await submitPin(user)

    expect(await screen.findByText('PP7K2M9QXA')).toBeInTheDocument()
    expect(posts).toHaveLength(2)
    expect(posts[1].body.amount).toBe('60000')
    expect(posts[1].key).toMatch(UUID)
    expect(posts[1].key).not.toBe(posts[0].key)
  })

  it('INVALID_PIN → still on the PIN step, the PIN cleared, attempts left shown', async () => {
    answers = [[403, apiError('INVALID_PIN', { attemptsLeft: 2 })]]
    const { user } = await renderPage('/send-money')
    await enterDetails(user)
    await confirmPreview(user)
    await submitPin(user)

    expect(await screen.findByText('Wrong PIN. 2 attempts left before your account locks.')).toBeInTheDocument()
    expect(pinField()).toHaveValue('')
    expect(screen.queryByText('PP7K2M9QXA')).not.toBeInTheDocument()
  })

  it('LIMIT_EXCEEDED → back on Preview with the message and its details', async () => {
    answers = [[422, apiError('LIMIT_EXCEEDED', { period: 'DAY', kind: 'AMOUNT', limit: '2500000', used: '2480000' })]]
    const { user } = await renderPage('/send-money')
    await enterDetails(user)
    await confirmPreview(user)
    await submitPin(user)

    expect(
      await screen.findByText('This would go over your daily limit of ৳25,000.00. Used today: ৳24,800.00.'),
    ).toBeInTheDocument()
    expect(screen.getByText(en.transfer.total)).toBeInTheDocument()
    expect(pinField()).not.toBeInTheDocument()
  })

  it.each(['INSUFFICIENT_BALANCE', 'RECEIVER_LIMIT_EXCEEDED', 'RECEIVER_BALANCE_LIMIT', 'RECEIVER_NOT_ACTIVE'] as const)(
    '%s → back on Preview with the message',
    async (code) => {
      answers = [[422, apiError(code)]]
      const { user } = await renderPage('/send-money')
      await enterDetails(user)
      await confirmPreview(user)
      await submitPin(user)

      expect(await screen.findByText(en.errors[code])).toBeInTheDocument()
      expect(screen.getByText(en.transfer.total)).toBeInTheDocument()
      expect(pinField()).not.toBeInTheDocument()
    },
  )

  it('ACCOUNT_LOCKED → home, with the unlock time', async () => {
    answers = [[423, apiError('ACCOUNT_LOCKED', { lockedUntil: '2026-11-25T06:30:00.000Z' })]]
    const { user, router } = await renderPage('/send-money')
    await enterDetails(user)
    await confirmPreview(user)
    await submitPin(user)

    expect(await screen.findByText(/locked until 25 Nov 2026, 12:30 pm/)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })
})

describe('TransferFlow drives Cash Out and Payment too', () => {
  it('Cash Out: a customer phone is refused (an agent is needed); an agent goes through to POST /cash-out', async () => {
    const { user } = await renderPage('/cash-out')
    const label = en.flows.CASH_OUT.receiver
    await user.type(receiverField(label), '01800000003')
    expect(await screen.findByText(en.transfer.wrongRole.AGENT)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.transfer.next })).toBeDisabled()

    await user.clear(receiverField(label))
    await enterDetails(user, { phone: '01800000004', label })
    await confirmPreview(user)
    await submitPin(user)

    expect(await screen.findByText('PP7K2M9QXA')).toBeInTheDocument()
    expect(previews).toEqual([{ type: 'CASH_OUT', receiverPhone: '01800000004', amount: '50000' }])
    expect(posts.map((p) => p.path)).toEqual(['cash-out'])
  })

  it('Payment: a customer phone is refused (a merchant is needed); a merchant goes through to POST /payment', async () => {
    const { user } = await renderPage('/payment')
    const label = en.flows.PAYMENT.receiver
    await user.type(receiverField(label), '01800000003')
    expect(await screen.findByText(en.transfer.wrongRole.MERCHANT)).toBeInTheDocument()

    await user.clear(receiverField(label))
    await enterDetails(user, { phone: '01800000005', label })
    await confirmPreview(user)
    await submitPin(user)

    const receipt = await screen.findByRole('region', { name: en.transfer.success })
    expect(within(receipt).getByText('Demo Store')).toBeInTheDocument()
    expect(posts.map((p) => p.path)).toEqual(['payment'])
  })
})
