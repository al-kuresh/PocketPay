import { act, fireEvent, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import bn from '../../i18n/bn.json'
import en from '../../i18n/en.json'
import { useLanguage } from '../../stores/language'
import { useSession } from '../../stores/session'
import { renderPage, renderRoutes } from '../../test/render'
import { apiError, server, testUser } from '../../test/server'

type User = ReturnType<typeof renderRoutes>['user']
type FlowPath = 'send-money' | 'cash-out' | 'payment'

// design-ok: a UUID regex, not a CSS class
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// design-ok: a UUID regex (version 4 and the RFC variant: the server's z.uuid() checks both), not a CSS class
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
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

/** On Confirm: the receipt card and the PIN. */
async function atConfirm() {
  await screen.findByText(en.transfer.total)
  expect(await screen.findByLabelText(en.transfer.pin)).toBeInTheDocument()
}

const HOLD_MS = 1200
const holdToSend = (total = '৳505.00') => en.transfer.holdToSend.replace('{{amount}}', total)

// Only setTimeout is faked, and it still runs with the clock, so lookups, MSW and findBy* work as usual.
afterEach(() => {
  vi.useRealTimers()
})
const fakeTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms))

/** Press the hold-to-send button with the pointer, keep it down for `ms`, let go. */
async function hold(user: User, name: string, ms = HOLD_MS) {
  const button = screen.getByRole('button', { name })
  fakeTimers()
  await user.pointer({ keys: '[MouseLeft>]', target: button })
  wait(ms)
  await user.pointer({ keys: '[/MouseLeft]', target: button })
  vi.useRealTimers()
}

async function submitPin(user: User, button = holdToSend()) {
  await user.type(pinField()!, '48213')
  await hold(user, button)
}

describe('TransferFlow: Send Money', () => {
  it('happy path: lookup → Confirm (receipt card, PIN, hold) → receipt, with the right request bodies and a UUID key', async () => {
    const { user, queryClient, router } = await renderPage('/send-money')
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await enterDetails(user)
    expect(lookups).toEqual(['01800000003']) // debounced: one lookup for the whole number, not one per digit
    expect(previews).toEqual([{ type: 'SEND_MONEY', receiverPhone: '01800000003', amount: '50000' }])

    // Confirm: receiver, amount, fee, and the total
    expect(await screen.findByText('Karim H***')).toBeInTheDocument()
    expect(screen.getByText('৳500.00')).toBeInTheDocument()
    expect(screen.getByText('৳5.00')).toBeInTheDocument()
    expect(screen.getByText('৳505.00')).toBeInTheDocument()

    await atConfirm()
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

  it('plain http on a LAN IP (dev:phone): no crypto.randomUUID, Confirm still opens and the POST has a UUID key', async () => {
    // Not a secure context: browsers only expose getRandomValues there.
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    try {
      const { user } = await renderPage('/send-money')
      await enterDetails(user)
      await atConfirm()
      await submitPin(user)
      expect(await screen.findByText('PP7K2M9QXA')).toBeInTheDocument()
      expect(posts[0].key).toMatch(UUID_V4)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it.each([
    [true, en.transfer.copied],
    [false, en.transfer.copyByHand.replace('{{trxId}}', 'PP7K2M9QXA')],
  ])('Share on plain http (no navigator.share or clipboard): execCommand copy → %s → "%s"', async (copied, toast) => {
    const { user } = await renderPage('/send-money')
    await enterDetails(user)
    await atConfirm()
    await submitPin(user)
    await screen.findByText('PP7K2M9QXA')

    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const execCommand = vi.fn(() => copied)
    const originalExec = document.execCommand
    document.execCommand = execCommand
    try {
      await user.click(screen.getByRole('button', { name: en.transfer.share }))
      expect(execCommand).toHaveBeenCalledWith('copy')
      expect(screen.getByRole('status')).toHaveTextContent(toast)
      expect(document.querySelector('textarea')).toBeNull() // the helper textarea is gone
    } finally {
      if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard)
      document.execCommand = originalExec
    }
  })

  it.each([
    ['NotAllowedError', true],
    ['AbortError', false],
  ])('navigator.share rejects with %s → copy fallback used: %s', async (name, copies) => {
    const { user } = await renderPage('/send-money')
    await enterDetails(user)
    await atConfirm()
    await submitPin(user)
    await screen.findByText('PP7K2M9QXA')

    const share = vi.fn().mockRejectedValue(new DOMException('no', name))
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const execCommand = vi.fn(() => true)
    const originalExec = document.execCommand
    document.execCommand = execCommand
    try {
      await user.click(screen.getByRole('button', { name: en.transfer.share }))
      expect(share).toHaveBeenCalled()
      if (copies) {
        expect(execCommand).toHaveBeenCalledWith('copy')
        expect(screen.getByRole('status')).toHaveTextContent(en.transfer.copied)
      } else {
        // The user closed the share sheet on purpose: nothing else happens.
        expect(execCommand).not.toHaveBeenCalled()
        expect(screen.getByRole('status')).toBeEmptyDOMElement()
      }
    } finally {
      Reflect.deleteProperty(navigator, 'share')
      if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard)
      document.execCommand = originalExec
    }
  })

  it('Review focus #2: a network error, then "Try again" → the SAME key, and the (replayed) receipt shows', async () => {
    answers = ['network']
    const { user } = await renderPage('/send-money')
    await enterDetails(user)
    await atConfirm()
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
    await atConfirm()
    await submitPin(user)
    await screen.findByText(en.errors.NETWORK_ERROR)

    // back from Confirm → Enter, with the values kept
    await user.click(screen.getByRole('button', { name: en.common.back }))
    expect(receiverField()).toHaveValue('01800000003')
    const amount = screen.getByLabelText(en.transfer.amount)
    expect(amount).toHaveValue('500')
    await user.clear(amount)
    await user.type(amount, '600')
    await user.click(screen.getByRole('button', { name: en.transfer.next }))
    await atConfirm()
    await submitPin(user, holdToSend('৳605.00'))

    expect(await screen.findByText('PP7K2M9QXA')).toBeInTheDocument()
    expect(posts).toHaveLength(2)
    expect(posts[1].body.amount).toBe('60000')
    expect(posts[1].key).toMatch(UUID)
    expect(posts[1].key).not.toBe(posts[0].key)
  })

  /** A NETWORK_ERROR on the money POST (did it pay? unknown), then Back to Enter. */
  async function networkErrorThenBack(user: User) {
    answers = ['network']
    await enterDetails(user)
    await atConfirm()
    await submitPin(user)
    await screen.findByText(en.errors.NETWORK_ERROR)
    await user.click(screen.getByRole('button', { name: en.common.back }))
  }

  it('after a NETWORK_ERROR: Back, delete and retype the SAME amount, confirm → the SAME key (no double payment)', async () => {
    const { user } = await renderPage('/send-money')
    await networkErrorThenBack(user)
    const amount = screen.getByLabelText(en.transfer.amount)
    await user.clear(amount)
    await user.type(amount, '500')
    await user.click(screen.getByRole('button', { name: en.transfer.next }))
    await atConfirm()
    await submitPin(user)

    expect(await screen.findByText('PP7K2M9QXA')).toBeInTheDocument()
    expect(posts).toHaveLength(2)
    expect(posts[1].key).toBe(posts[0].key)
  })

  it('after a NETWORK_ERROR: Back, change only the note, confirm → the SAME key', async () => {
    const { user } = await renderPage('/send-money')
    await networkErrorThenBack(user)
    await user.click(screen.getByRole('button', { name: en.transfer.next }))
    await atConfirm()
    await user.type(screen.getByLabelText(en.transfer.note), 'rent')
    await submitPin(user)

    expect(await screen.findByText('PP7K2M9QXA')).toBeInTheDocument()
    expect(posts).toHaveLength(2)
    expect(posts[1].key).toBe(posts[0].key)
    expect(posts[1].body.note).toBe('rent')
  })

  it('while the money POST is pending: Back, the note and the PIN field are disabled', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    server.use(
      http.post('/api/v1/transactions/send-money', async () => {
        await held
        return HttpResponse.json(apiError('INVALID_PIN', { attemptsLeft: 2 }), { status: 403 })
      }),
    )
    const { user } = await renderPage('/send-money')
    await enterDetails(user)
    await atConfirm()
    await submitPin(user)

    expect(await screen.findByRole('button', { name: holdToSend(), busy: true })).toBeDisabled()
    expect(screen.getByRole('button', { name: en.common.back })).toBeDisabled()
    expect(pinField()).toBeDisabled()
    expect(screen.getByLabelText(en.transfer.note)).toBeDisabled()

    release()
    expect(await screen.findByText('Wrong PIN. 2 attempts left before your account locks.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.common.back })).toBeEnabled()
  })

  it('INVALID_PIN → still on Confirm, the PIN cleared, attempts left shown', async () => {
    answers = [[403, apiError('INVALID_PIN', { attemptsLeft: 2 })]]
    const { user } = await renderPage('/send-money')
    await enterDetails(user)
    await atConfirm()
    await submitPin(user)

    expect(await screen.findByText('Wrong PIN. 2 attempts left before your account locks.')).toBeInTheDocument()
    expect(pinField()).toHaveValue('')
    expect(screen.queryByText('PP7K2M9QXA')).not.toBeInTheDocument()
  })

  it('LIMIT_EXCEEDED → shown on Confirm with its details', async () => {
    answers = [[422, apiError('LIMIT_EXCEEDED', { period: 'DAY', kind: 'AMOUNT', limit: '2500000', used: '2480000' })]]
    const { user } = await renderPage('/send-money')
    await enterDetails(user)
    await atConfirm()
    await submitPin(user)

    expect(
      await screen.findByText('This would go over your daily limit of ৳25,000.00. Used today: ৳24,800.00.'),
    ).toBeInTheDocument()
    expect(screen.getByText(en.transfer.total)).toBeInTheDocument()
    expect(pinField()).toHaveValue('')
    expect(screen.queryByText('PP7K2M9QXA')).not.toBeInTheDocument()
  })

  it.each(['INSUFFICIENT_BALANCE', 'RECEIVER_LIMIT_EXCEEDED', 'RECEIVER_BALANCE_LIMIT', 'RECEIVER_NOT_ACTIVE'] as const)(
    '%s → shown on Confirm',
    async (code) => {
      answers = [[422, apiError(code)]]
      const { user } = await renderPage('/send-money')
      await enterDetails(user)
      await atConfirm()
      await submitPin(user)

      expect(await screen.findByText(en.errors[code])).toBeInTheDocument()
      expect(screen.getByText(en.transfer.total)).toBeInTheDocument()
      expect(pinField()).toHaveValue('')
    },
  )

  it('ACCOUNT_LOCKED → home, with the unlock time', async () => {
    answers = [[423, apiError('ACCOUNT_LOCKED', { lockedUntil: '2026-11-25T06:30:00.000Z' })]]
    const { user, router } = await renderPage('/send-money')
    await enterDetails(user)
    await atConfirm()
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
    await atConfirm()
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
    await atConfirm()
    await submitPin(user)

    const receipt = await screen.findByRole('region', { name: en.transfer.success })
    expect(within(receipt).getByText('Demo Store')).toBeInTheDocument()
    expect(posts.map((p) => p.path)).toEqual(['payment'])
  })
})

describe('the amount screen: keypad, chips, fee from preview', () => {
  const amountField = () => screen.getByLabelText(en.transfer.amount)
  const key = (name: string) => screen.getByRole('button', { name })

  /** Receiver typed and looked up: the amount screen is ready. */
  async function toAmount(user: User) {
    await user.type(receiverField(), '01800000003')
    await screen.findByText('Karim H***')
  }

  async function next(user: User) {
    await user.click(screen.getByRole('button', { name: en.transfer.next }))
    await screen.findByText(en.transfer.total)
  }

  it('the keypad edits the amount; Next previews the poisha from takaToPoisha', async () => {
    const { user } = await renderPage('/send-money')
    await toAmount(user)
    for (const k of ['1', '2', '5', '.', '5']) await user.click(key(k))
    expect(amountField()).toHaveValue('125.5')
    await next(user)
    expect(previews).toEqual([{ type: 'SEND_MONEY', receiverPhone: '01800000003', amount: '12550' }])
  })

  it('a 3rd decimal is refused, and Delete takes off the last character', async () => {
    const { user } = await renderPage('/send-money')
    await toAmount(user)
    for (const k of ['1', '.', '2', '3', '4']) await user.click(key(k))
    expect(amountField()).toHaveValue('1.23')
    await user.click(key(en.amount.delete))
    expect(amountField()).toHaveValue('1.2')
    await next(user)
    expect(previews).toEqual([{ type: 'SEND_MONEY', receiverPhone: '01800000003', amount: '120' }])
  })

  it.each([
    ['৳500', '50000'],
    ['৳1,000', '100000'],
    ['৳2,000', '200000'],
  ])('the quick chip %s sets the amount (poisha %s), replacing what was typed', async (chip, poisha) => {
    const { user } = await renderPage('/send-money')
    await toAmount(user)
    await user.click(key('7'))
    await user.click(key(chip))
    await next(user)
    expect(previews).toEqual([{ type: 'SEND_MONEY', receiverPhone: '01800000003', amount: poisha }])
  })

  it('bn: the keys and the amount show Bangla digits; the poisha is the same', async () => {
    act(() => useLanguage.getState().setLang('bn'))
    try {
      const { user } = await renderPage('/send-money')
      await user.type(screen.getByLabelText(bn.flows.SEND_MONEY.receiver), '01800000003')
      await screen.findByText('Karim H***')
      for (const k of ['৫', '০', '০']) await user.click(key(k))
      expect(screen.getByLabelText(bn.transfer.amount)).toHaveValue('৫০০')
      expect(key('৳১,০০০')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: bn.transfer.next }))
      await screen.findByText(bn.transfer.total)
      expect(previews).toEqual([{ type: 'SEND_MONEY', receiverPhone: '01800000003', amount: '50000' }])
    } finally {
      act(() => useLanguage.getState().setLang('en'))
    }
  })

  it('a physical keyboard still types into the amount, under the same rules', async () => {
    const { user } = await renderPage('/send-money')
    await toAmount(user)
    await user.type(amountField(), '75x.505')
    expect(amountField()).toHaveValue('75.50')
    await user.type(amountField(), '{Backspace}{Backspace}')
    expect(amountField()).toHaveValue('75.')
    expect(screen.getByRole('button', { name: en.transfer.next })).toBeDisabled() // "75." is not an amount yet
    await user.type(amountField(), '{Backspace}')
    await next(user)
    expect(previews).toEqual([{ type: 'SEND_MONEY', receiverPhone: '01800000003', amount: '7500' }])
  })

  it('the phone keyboard never opens for the amount (inputmode none)', async () => {
    await renderPage('/send-money')
    expect(amountField()).toHaveAttribute('inputmode', 'none')
  })

  it('the fee line comes from preview; Next fetches a FRESH preview, so Confirm shows the current fee', async () => {
    let fee = '500'
    server.use(
      http.post('/api/v1/transactions/preview', async ({ request }) => {
        const body = (await request.json()) as { type: string; receiverPhone: string; amount: string }
        previews.push(body)
        const receiver = { phone: body.receiverPhone, ...PEOPLE[body.receiverPhone] }
        const total = (BigInt(body.amount) + BigInt(fee)).toString()
        return HttpResponse.json({ success: true, data: { ...body, fee, total, receiver } })
      }),
    )
    const { user } = await renderPage('/send-money')
    await toAmount(user)
    expect(screen.queryByText(/Fee ৳/)).not.toBeInTheDocument()
    await user.click(key('৳500'))
    expect(await screen.findByText('Fee ৳5.00')).toBeInTheDocument()
    expect(previews).toEqual([{ type: 'SEND_MONEY', receiverPhone: '01800000003', amount: '50000' }])

    fee = '1000' // an admin changed the fee rule after the fee line was fetched
    await next(user)
    expect(previews).toHaveLength(2)
    expect(screen.getByText('৳10.00')).toBeInTheDocument()
    expect(screen.getByText('৳510.00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: holdToSend('৳510.00') })).toBeInTheDocument()
  })

  it('the note is not on the amount screen (it is on Confirm)', async () => {
    await renderPage('/send-money')
    expect(screen.queryByLabelText(en.transfer.note)).not.toBeInTheDocument()
  })

  it('a zero fee from preview reads "No fee"', async () => {
    server.use(
      http.post('/api/v1/transactions/preview', async ({ request }) => {
        const body = (await request.json()) as { type: string; receiverPhone: string; amount: string }
        const receiver = { phone: body.receiverPhone, ...PEOPLE[body.receiverPhone] }
        return HttpResponse.json({ success: true, data: { ...body, fee: '0', total: body.amount, receiver } })
      }),
    )
    const { user } = await renderPage('/send-money')
    await toAmount(user)
    await user.click(key('৳500'))
    expect(await screen.findByText(en.transfer.noFee)).toBeInTheDocument()
  })

  it('the receiver card shows the looked-up name and number; Change clears it for a new number', async () => {
    const { user } = await renderPage('/send-money')
    await toAmount(user)
    expect(receiverField()).toHaveValue('01800000003')
    await user.click(screen.getByRole('button', { name: en.transfer.change }))
    expect(screen.queryByText('Karim H***')).not.toBeInTheDocument()
    expect(receiverField()).toHaveValue('')
    expect(receiverField()).toHaveFocus()
  })
})

describe('Confirm: hold to send', () => {
  /** On Confirm for ৳500 to Karim, with the PIN typed. */
  async function ready() {
    const rendered = await renderPage('/send-money')
    await enterDetails(rendered.user)
    await atConfirm()
    await rendered.user.type(pinField()!, '48213')
    return { ...rendered, button: screen.getByRole('button', { name: holdToSend() }) }
  }

  it('one Confirm screen: the receipt card (receiver, amount, fee, note, stitched tear line, total), the PIN and the hold button', async () => {
    const { button } = await ready()
    expect(screen.getByText('Karim H***')).toBeInTheDocument()
    expect(screen.getByText('01800000003')).toBeInTheDocument()
    expect(screen.getByText('৳500.00')).toBeInTheDocument()
    expect(screen.getByText('৳5.00')).toBeInTheDocument()
    expect(screen.getByLabelText(en.transfer.note)).toBeInTheDocument()
    expect(screen.getByText('৳505.00')).toHaveClass('font-amount')
    expect(document.querySelector('svg line[stroke-dasharray="7 9"]')).not.toBeNull() // the tear line
    expect(button.querySelector('svg rect[stroke-dasharray="7 9"]')).not.toBeNull() // the stitched button
    expect(button).toHaveAccessibleDescription(en.transfer.holdHint)
    expect(screen.getByRole('heading', { name: en.transfer.checkTitle })).toBeInTheDocument()
  })

  it('a short press (a tap) does not submit', async () => {
    const { user, button } = await ready()
    fakeTimers()
    await user.click(button)
    wait(HOLD_MS * 3)
    expect(posts).toHaveLength(0)
    expect(screen.queryByText('PP7K2M9QXA')).not.toBeInTheDocument()
  })

  it('a full hold submits exactly once, even when held on long after it completes', async () => {
    const { user, button } = await ready()
    fakeTimers()
    await user.pointer({ keys: '[MouseLeft>]', target: button })
    wait(HOLD_MS - 300)
    expect(posts).toHaveLength(0)
    wait(300)
    wait(HOLD_MS * 3) // still holding
    await user.pointer({ keys: '[/MouseLeft]', target: button })
    vi.useRealTimers()
    expect(await screen.findByText('PP7K2M9QXA')).toBeInTheDocument()
    expect(posts).toHaveLength(1)
  })

  it('letting go early cancels and resets; a new full hold still works', async () => {
    const { user, button } = await ready()
    fakeTimers()
    await user.pointer({ keys: '[MouseLeft>]', target: button })
    expect(button).toHaveAttribute('data-holding', 'true')
    wait(HOLD_MS - 300)
    await user.pointer({ keys: '[/MouseLeft]', target: button })
    expect(button).toHaveAttribute('data-holding', 'false')
    wait(HOLD_MS * 3)
    expect(posts).toHaveLength(0)

    await user.pointer({ keys: '[MouseLeft>]', target: button })
    wait(HOLD_MS)
    await user.pointer({ keys: '[/MouseLeft]', target: button })
    vi.useRealTimers()
    expect(await screen.findByText('PP7K2M9QXA')).toBeInTheDocument()
    expect(posts).toHaveLength(1)
  })

  it('a pointer cancel (the browser takes the touch) resets the hold', async () => {
    const { button } = await ready()
    fakeTimers()
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 })
    wait(HOLD_MS - 300)
    fireEvent.pointerCancel(button, { pointerId: 1 })
    wait(HOLD_MS * 3)
    expect(posts).toHaveLength(0)
  })

  it.each([
    ['Enter', '{Enter>}', '{/Enter}'],
    ['Space', '[Space>]', '[/Space]'],
  ])('keyboard: %s held for the full time submits once; a short press does not', async (_, down, up) => {
    const { user, button } = await ready()
    act(() => button.focus())
    fakeTimers()
    await user.keyboard(down)
    wait(HOLD_MS - 300)
    await user.keyboard(up)
    wait(HOLD_MS * 3)
    expect(posts).toHaveLength(0)

    await user.keyboard(down)
    wait(HOLD_MS)
    await user.keyboard(up)
    vi.useRealTimers()
    expect(await screen.findByText('PP7K2M9QXA')).toBeInTheDocument()
    expect(posts).toHaveLength(1)
  })

  it('Enter in the PIN field does not send', async () => {
    const { user } = await ready()
    fakeTimers()
    await user.type(pinField()!, '{Enter}')
    wait(HOLD_MS * 3)
    expect(posts).toHaveLength(0)
  })

  it('vibrates (30 ms) when the hold completes, when the phone can', async () => {
    const vibrate = vi.fn(() => true)
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
    try {
      const { user } = await ready()
      fakeTimers()
      await user.pointer({ keys: '[MouseLeft>]', target: screen.getByRole('button', { name: holdToSend() }) })
      wait(HOLD_MS - 300)
      expect(vibrate).not.toHaveBeenCalled()
      wait(300)
      expect(vibrate).toHaveBeenCalledExactlyOnceWith(30)
      vi.useRealTimers()
      expect(await screen.findByText('PP7K2M9QXA')).toBeInTheDocument()
    } finally {
      Reflect.deleteProperty(navigator, 'vibrate')
    }
  })

  it('with fewer than 5 PIN digits the button is disabled and a hold does nothing', async () => {
    const { user } = await renderPage('/send-money')
    await enterDetails(user)
    await atConfirm()
    await user.type(pinField()!, '4821')
    const button = screen.getByRole('button', { name: holdToSend() })
    expect(button).toBeDisabled()
    fakeTimers()
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 })
    wait(HOLD_MS * 2)
    expect(posts).toHaveLength(0)
  })

  it('reduced motion: the fill does not animate (no transition), but the hold time still applies', async () => {
    const { user, button } = await ready()
    // The sweep and its reduced-motion rule live in the hold-fill utility (index.css): jsdom can't evaluate media
    // queries, so that rule is checked in a real browser. Here: the fill uses it, and the hold time still applies.
    expect(button.querySelector('[data-fill]')).toHaveClass('hold-fill')
    fakeTimers()
    await user.pointer({ keys: '[MouseLeft>]', target: button })
    wait(HOLD_MS - 300)
    await user.pointer({ keys: '[/MouseLeft]', target: button })
    wait(HOLD_MS)
    expect(posts).toHaveLength(0)
  })

  it('NETWORK_ERROR: the note can still be changed on Confirm, and "Try again" is a new hold with the SAME key', async () => {
    answers = ['network']
    const { user } = await ready()
    await hold(user, holdToSend())
    expect(await screen.findByText(en.errors.NETWORK_ERROR)).toBeInTheDocument()
    await user.type(screen.getByLabelText(en.transfer.note), 'rent')

    await user.type(pinField()!, '48213')
    const retry = screen.getByRole('button', { name: en.transfer.tryAgain })
    fakeTimers()
    await user.click(retry) // a tap is not enough
    wait(HOLD_MS * 2)
    expect(posts).toHaveLength(1)
    vi.useRealTimers()

    await hold(user, en.transfer.tryAgain)
    expect(await screen.findByText('PP7K2M9QXA')).toBeInTheDocument()
    expect(posts).toHaveLength(2)
    expect(posts[1].key).toBe(posts[0].key)
    expect(posts[1].body.note).toBe('rent')
  })
})
