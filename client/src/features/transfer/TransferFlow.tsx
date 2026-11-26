import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { startTransition, useEffect, useId, useRef, useState, ViewTransition, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ApiError } from '../../api/client'
import { lookup, preview as fetchPreview, transfer } from '../../api/transactions'
import type { Preview, Receipt, TxType } from '../../api/types'
import { AppShell } from '../../components/layout/AppShell'
import { MobileShell } from '../../components/layout/MobileShell'
import { AmountChips, AmountField, AmountKeypad } from '../../components/ui/AmountKeypad'
import { Button } from '../../components/ui/Button'
import { HoldToSendButton } from '../../components/ui/HoldToSendButton'
import { Initials } from '../../components/ui/Initials'
import { PhoneInput } from '../../components/ui/PhoneInput'
import { PinInput, type PinInputHandle } from '../../components/ui/PinInput'
import { Stitch } from '../../components/ui/Stitch'
import { useToast } from '../../components/ui/toast-context'
import { errorMessage } from '../../i18n/errors'
import { formatTaka, takaToPoisha } from '../../lib/money'
import { phoneSchema } from '../../lib/validation'
import { useLanguage } from '../../stores/language'
import { FLOWS, type Flow } from './flows'
import { Counterparty, ReceiptCard, ShareButton, TearLine } from './ReceiptCard'

type Step = 'enter' | 'confirm' | 'receipt'

/** What the user entered. Lives here, so Back from Confirm shows it again. */
interface Details {
  phone: string
  amountText: string
  poisha: string | null
  note: string
}

const LOOKUP_DELAY_MS = 300
// The fee line's preview waits for the amount to settle and is kept for a minute, so going back to an amount
// doesn't ask again (previews have their own budget, 60 a minute per user). Next always asks afresh.
const QUOTE_DELAY_MS = 500
const QUOTE_FRESH_MS = 60_000
const PIN_LENGTH = 5

/** `value`, once it has stopped changing for `ms`. */
function useSettled<T>(value: T, ms: number) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

/** A v4 UUID. Not crypto.randomUUID: that exists only in secure contexts, and dev:phone is plain http on a LAN IP. */
function uuidV4() {
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40 // version 4
  b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Every money flow: Enter → Confirm (the receipt card, the PIN, hold to send) → Receipt (design §6.3). `type` picks the row of the flow table. */
export function TransferFlow({ type }: { type: TxType }) {
  const flow = FLOWS[type]
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>('enter')
  const [details, setDetails] = useState<Details>({ phone: '', amountText: '', poisha: null, note: '' })
  const [preview, setPreview] = useState<Preview | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  // One key per payment: made when Confirm first opens, and kept (every retry, Back and back again, a new note)
  // while the receiver and amount it was made for stay the same. Only a different receiver or amount gets a new
  // one: a lost response ("did it pay?") followed by a retyped, identical amount must replay, never pay twice.
  const [key, setKey] = useState<{ value: string; phone: string; amount: string } | null>(null)
  const sending = useIsMutating({ mutationKey: ['transfer'] }) > 0

  function change(patch: Partial<Details>) {
    setDetails((d) => ({ ...d, ...patch }))
  }

  function openConfirm(p: Preview) {
    const phone = p.receiver.phone ?? ''
    if (!key || key.phone !== phone || key.amount !== p.amount) setKey({ value: uuidV4(), phone, amount: p.amount })
    // In a transition, so <ViewTransition name="amount"> carries the amount from the keypad to Confirm.
    startTransition(() => {
      setPreview(p)
      setStep('confirm')
    })
  }

  function succeed(r: Receipt) {
    startTransition(() => {
      setReceipt(r)
      setStep('receipt')
    })
    void queryClient.invalidateQueries({ queryKey: ['me'] })
    void queryClient.invalidateQueries({ queryKey: ['history'] })
  }

  if (step === 'receipt' && receipt) return <SentView receipt={receipt} />

  const onBack = step === 'enter' ? () => void navigate('/') : () => startTransition(() => setStep('enter'))

  return (
    <AppShell
      title={step === 'confirm' ? t('transfer.checkTitle') : t(flow.titleKey)}
      onBack={onBack}
      backDisabled={sending}
      canvas={step === 'confirm'}
    >
      {step === 'enter' && <EnterStep type={type} flow={flow} details={details} onChange={change} onNext={openConfirm} />}
      {step === 'confirm' && preview && key && (
        <ConfirmStep
          flow={flow}
          preview={preview}
          note={details.note}
          onNoteChange={(note) => change({ note })}
          idempotencyKey={key.value}
          onSuccess={succeed}
        />
      )}
    </AppShell>
  )
}

interface EnterStepProps {
  type: TxType
  flow: Flow
  details: Details
  onChange(patch: Partial<Details>): void
  onNext(preview: Preview): void
}

/** The receiver (looked up once typing stops, then shown as a card), and the amount on the keypad with its fee. */
function EnterStep({ type, flow, details, onChange, onNext }: EnterStepProps) {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const queryClient = useQueryClient()
  const amountField = useRef<HTMLInputElement>(null)
  const [changing, setChanging] = useState(false)
  const parsed = phoneSchema.safeParse(details.phone)
  const phone = parsed.success ? parsed.data : null
  const settled = useSettled(phone, LOOKUP_DELAY_MS)

  const ready = phone !== null && settled === phone
  const who = useQuery({ queryKey: ['lookup', settled], queryFn: () => lookup(settled ?? ''), enabled: ready })
  const receiver = ready ? who.data : undefined
  const wrongRole = receiver !== undefined && receiver.role !== flow.receiver
  const phoneError =
    details.phone.length >= 11 && !phone
      ? t('validation.phone')
      : ready && who.isError
        ? errorMessage(t, who.error)
        : wrongRole
          ? t(`transfer.wrongRole.${flow.receiver}`)
          : undefined

  const found = receiver !== undefined && !wrongRole

  // The fee is always the server's, never worked out here. Next fetches it fresh (staleTime 0, and into the same
  // cache entry), so Confirm shows the current fee, not the one the fee line got earlier.
  const quote = {
    queryKey: ['preview', type, phone, details.poisha],
    queryFn: () => fetchPreview({ type, receiverPhone: phone ?? '', amount: details.poisha ?? '' }),
    staleTime: QUOTE_FRESH_MS,
  }
  const settledPoisha = useSettled(details.poisha, QUOTE_DELAY_MS)
  const fee = useQuery({ ...quote, enabled: found && details.poisha !== null && settledPoisha === details.poisha }).data?.fee
  const check = useMutation({ mutationFn: () => queryClient.fetchQuery({ ...quote, staleTime: 0 }), onSuccess: onNext })
  const canNext = found && details.poisha !== null

  // The card replaces the number field when the lookup lands, which drops focus: put it on the amount, not the page.
  useEffect(() => {
    if (found && document.activeElement === document.body) amountField.current?.focus()
  }, [found])

  function setAmount(text: string) {
    onChange({ amountText: text, poisha: takaToPoisha(text) })
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (canNext) check.mutate()
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-1 flex-col gap-6">
      {!found && (
        <PhoneInput
          label={t(`flows.${type}.receiver`)}
          value={details.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
          error={phoneError}
          autoFocus={changing}
        />
      )}
      <div aria-live="polite">
        {found && (
          <div className="flex items-center gap-3 rounded-3xl border border-border p-4">
            <Initials name={receiver.name} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-base font-semibold text-text">{receiver.name}</span>
              {/* Still the receiver field, read-only, so the number keeps its label for screen readers (and Back).
                  Not tappable either: focusing a 14px input zooms an iPhone. Change edits it. */}
              <input
                readOnly
                tabIndex={-1}
                aria-label={t(`flows.${type}.receiver`)}
                value={details.phone}
                className="pointer-events-none min-w-0 bg-transparent text-sm tabular-nums text-text-muted"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setChanging(true)
                onChange({ phone: '' })
              }}
              className="min-h-11 rounded-xl px-2 text-sm font-semibold text-primary-dark hover:bg-primary-50"
            >
              {t('transfer.change')}
            </button>
          </div>
        )}
      </div>
      <div className="flex flex-col items-center gap-3">
        <AmountField ref={amountField} label={t('transfer.amount')} text={details.amountText} onTextChange={setAmount} />
        <p aria-live="polite" className="min-h-6 text-sm text-text-muted">
          {fee !== undefined &&
            (fee === '0' ? t('transfer.noFee') : t('transfer.feeLine', { fee: formatTaka(fee, { lang }) }))}
        </p>
        <AmountChips onTextChange={setAmount} />
      </div>
      {check.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, check.error)}
        </p>
      )}
      <div className="mt-auto flex flex-col gap-4">
        <AmountKeypad text={details.amountText} onTextChange={setAmount} />
        <Button type="submit" disabled={!canNext} loading={check.isPending}>
          {t('transfer.next')}
          {!check.isPending && <ArrowRight aria-hidden className="size-5" />}
        </Button>
      </div>
    </form>
  )
}

interface ConfirmStepProps {
  flow: Flow
  preview: Preview
  note: string
  onNoteChange(note: string): void
  idempotencyKey: string
  onSuccess(receipt: Receipt): void
}

/**
 * One screen (TASTE.md): the receipt card (receiver, amount, fee, the note, a stitched tear line, the total as the
 * hero), the PIN, and hold to send. The POST carries the flow's Idempotency-Key; the PIN is cleared on every submit.
 */
function ConfirmStep({ flow, preview, note, onNoteChange, idempotencyKey, onSuccess }: ConfirmStepProps) {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const navigate = useNavigate()
  const toast = useToast()
  const noteId = useId()
  const pinInput = useRef<PinInputHandle>(null)
  const pin = useRef('') // a ref, not state: the PIN is never rendered
  const [length, setLength] = useState(0)
  const [failure, setFailure] = useState<{ message: string; code: string } | null>(null)

  const send = useMutation({
    mutationKey: ['transfer'], // TransferFlow disables Back while this is pending
    mutationFn: (value: string) =>
      transfer(
        flow.path,
        // What the user saw on Confirm: the server's normalised phone and the previewed amount.
        { receiverPhone: preview.receiver.phone ?? '', amount: preview.amount, pin: value, note: note.trim() || undefined },
        idempotencyKey,
      ),
  })

  function submit() {
    if (send.isPending || pin.current.length < PIN_LENGTH) return
    const value = pin.current
    pinInput.current?.clear()
    send.mutate(value, {
      onSuccess: (data) => onSuccess(data.receipt),
      onError: (err) => {
        const message = errorMessage(t, err)
        const code = err instanceof ApiError ? err.code : ''
        if (code === 'ACCOUNT_LOCKED') {
          toast.show(message)
          void navigate('/', { replace: true })
          return
        }
        // INVALID_PIN (attempts left), limits and balance, NETWORK_ERROR ("Try again", same key): stay here.
        setFailure({ message, code })
        pinInput.current?.focus()
      },
    })
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="rounded-3xl border border-border bg-surface">
        <div className="flex items-center gap-3 p-6 pb-4">
          <Initials name={preview.receiver.name} />
          <div className="flex min-w-0 flex-col">
            <p className="text-sm text-text-muted">{t('transfer.to')}</p>
            <p className="truncate text-base font-semibold text-text">{preview.receiver.name}</p>
            {preview.receiver.phone && <p className="text-sm tabular-nums text-text-muted">{preview.receiver.phone}</p>}
          </div>
        </div>
        <dl className="flex flex-col gap-3 px-6 pb-4 text-base">
          <Row label={t('transfer.amount')}>{formatTaka(preview.amount, { lang })}</Row>
          <Row label={t('transfer.fee')}>{formatTaka(preview.fee, { lang })}</Row>
        </dl>
        <div className="flex items-center gap-3 px-6 pb-4">
          <label htmlFor={noteId} className="shrink-0 text-base text-text-muted">
            {t('transfer.note')}
          </label>
          <input
            id={noteId}
            value={note}
            maxLength={50}
            disabled={send.isPending}
            onChange={(e) => onNoteChange(e.target.value)}
            className="h-12 min-w-0 flex-1 rounded-xl border border-border-strong bg-surface px-3 text-right text-base text-text disabled:bg-surface-sunken"
          />
        </div>
        <TearLine />
        <div className="flex items-baseline justify-between gap-3 p-6 pt-4">
          <p className="text-base text-text-muted">{t('transfer.total')}</p>
          <ViewTransition name="amount">
            <p className="font-amount text-4xl font-semibold text-text">{formatTaka(preview.total, { lang })}</p>
          </ViewTransition>
        </div>
      </div>
      <PinInput
        disabled={send.isPending}
        ref={pinInput}
        label={t('transfer.pin')}
        lock
        error={failure?.code === 'INVALID_PIN' ? failure.message : undefined}
        onChange={(value) => {
          pin.current = value
          setLength(value.length)
        }}
      />
      {failure && failure.code !== 'INVALID_PIN' && (
        <p role="alert" className="text-sm text-danger">
          {failure.message}
        </p>
      )}
      <div className="mt-auto">
        <HoldToSendButton
          label={
            failure?.code === 'NETWORK_ERROR'
              ? t('transfer.tryAgain')
              : t(`flows.${preview.type}.hold`, { amount: formatTaka(preview.total, { lang }) })
          }
          disabled={length < PIN_LENGTH}
          loading={send.isPending}
          onHold={submit}
        />
      </div>
    </div>
  )
}

/**
 * The flow's last step, like the canvas: the orange block with the stitched ring, the tick drawing itself, "Money
 * sent" and the amount rising into place (the one signature moment), then the receipt card, Share and Done. Under
 * reduced motion nothing animates: the tick is simply drawn and the amount simply there.
 */
function SentView({ receipt }: { receipt: Receipt }) {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const navigate = useNavigate()
  const headingId = useId()
  return (
    <MobileShell>
      <section aria-labelledby={headingId} className="flex flex-1 flex-col bg-canvas">
        {/* pb-16: the card overlaps the block's lower edge, like Home's action panel. */}
        <div className="flex flex-col items-center gap-3 rounded-b-3xl bg-primary-dark px-6 pt-safe pb-16 text-center text-white">
          <div className="relative mt-12 flex size-20 items-center justify-center">
            <Stitch shape="circle" className="absolute inset-0 size-full stroke-thread" />
            <span className="flex size-14 items-center justify-center rounded-full bg-white">
              <svg aria-hidden viewBox="0 0 24 24" className="size-8 stroke-primary-dark">
                {/* pathLength 1 and a dash of 1: the animation draws it from dashoffset 1 to 0. */}
                <path
                  data-tick
                  d="M5 12.5l4.5 4.5L19 7.5"
                  pathLength={1}
                  strokeDasharray="1"
                  fill="none"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="animate-tick motion-reduce:animate-none"
                />
              </svg>
            </span>
          </div>
          <h1 id={headingId} className="mt-3 font-display text-xl font-semibold">
            {t('transfer.success')}
          </h1>
          {/* No <ViewTransition name="amount"> here: the rise is Sent's landing, and a morph would fly into a still-invisible amount. */}
          <p className="font-amount text-hero font-semibold animate-rise motion-reduce:animate-none">
            {formatTaka(receipt.amount, { lang })}
          </p>
          <Counterparty receipt={receipt} />
        </div>
        <div className="-mt-12 flex flex-1 flex-col gap-6 px-6 pb-6">
          <ReceiptCard receipt={receipt} />
          <div className="mt-auto grid grid-cols-2 gap-3 pb-safe">
            <ShareButton trxId={receipt.trxId} />
            <Button onClick={() => void navigate('/')}>{t('transfer.done')}</Button>
          </div>
        </div>
      </section>
    </MobileShell>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-base text-text-muted">{label}</dt>
      <dd className="text-right text-base tabular-nums text-text">{children}</dd>
    </div>
  )
}
