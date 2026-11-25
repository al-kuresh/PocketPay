import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, Share2 } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ApiError } from '../../api/client'
import { lookup, preview as fetchPreview, transfer } from '../../api/transactions'
import type { Party, Preview, Receipt, TxType } from '../../api/types'
import { AppShell } from '../../components/layout/AppShell'
import { AmountInput } from '../../components/ui/AmountInput'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { PhoneInput } from '../../components/ui/PhoneInput'
import { PinInput, type PinInputHandle } from '../../components/ui/PinInput'
import { useToast } from '../../components/ui/toast-context'
import { errorMessage } from '../../i18n/errors'
import { formatDateTime } from '../../lib/dates'
import { formatTaka } from '../../lib/money'
import { phoneSchema } from '../../lib/validation'
import { useLanguage, type Lang } from '../../stores/language'
import { FLOWS, type Flow } from './flows'

type Step = 'enter' | 'preview' | 'pin' | 'receipt'

/** What the user entered. Lives here, so Back from Preview or PIN shows it again. */
interface Details {
  phone: string
  amountText: string
  poisha: string | null
  note: string
}

/** Refusals the Preview explains: back there with the message (the PIN was fine). */
const BACK_TO_PREVIEW = new Set([
  'INSUFFICIENT_BALANCE',
  'LIMIT_EXCEEDED',
  'RECEIVER_LIMIT_EXCEEDED',
  'RECEIVER_BALANCE_LIMIT',
  'RECEIVER_NOT_ACTIVE',
])

const LOOKUP_DELAY_MS = 300
const PIN_LENGTH = 5

/** Every money flow: Enter → Preview → PIN → Receipt (design §6.3). `type` picks the row of the flow table. */
export function TransferFlow({ type }: { type: TxType }) {
  const flow = FLOWS[type]
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>('enter')
  const [details, setDetails] = useState<Details>({ phone: '', amountText: '', poisha: null, note: '' })
  const [preview, setPreview] = useState<Preview | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  // One key per confirm: made when the PIN step opens, reused by every retry, dropped by any change to the details.
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null)

  function change(patch: Partial<Details>) {
    setDetails((d) => ({ ...d, ...patch }))
    setIdempotencyKey(null)
  }

  function openPin() {
    if (!idempotencyKey) setIdempotencyKey(crypto.randomUUID())
    setStep('pin')
  }

  function succeed(r: Receipt) {
    setReceipt(r)
    setStep('receipt')
    void queryClient.invalidateQueries({ queryKey: ['me'] })
    void queryClient.invalidateQueries({ queryKey: ['history'] })
  }

  const onBack =
    step === 'enter' ? () => void navigate('/') : step === 'receipt' ? undefined : () => setStep('enter')

  return (
    <AppShell title={t(flow.titleKey)} onBack={onBack}>
      {step === 'enter' && (
        <EnterStep
          type={type}
          flow={flow}
          details={details}
          onChange={change}
          onNext={(p) => {
            setPreview(p)
            setNotice(null)
            setStep('preview')
          }}
        />
      )}
      {step === 'preview' && preview && <PreviewStep preview={preview} notice={notice} onNext={openPin} />}
      {step === 'pin' && preview && idempotencyKey && (
        <PinStep
          flow={flow}
          preview={preview}
          note={details.note}
          idempotencyKey={idempotencyKey}
          onSuccess={succeed}
          onRefused={(message) => {
            setNotice(message)
            setStep('preview')
          }}
        />
      )}
      {step === 'receipt' && receipt && <ReceiptView receipt={receipt} />}
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

/** The receiver (looked up once typing stops), the amount, an optional note. */
function EnterStep({ type, flow, details, onChange, onNext }: EnterStepProps) {
  const { t } = useTranslation()
  const parsed = phoneSchema.safeParse(details.phone)
  const phone = parsed.success ? parsed.data : null
  const [settled, setSettled] = useState(phone)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(phone), LOOKUP_DELAY_MS)
    return () => clearTimeout(timer)
  }, [phone])

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

  const check = useMutation({ mutationFn: fetchPreview, onSuccess: onNext })
  const canNext = receiver !== undefined && !wrongRole && details.poisha !== null

  function submit(e: FormEvent) {
    e.preventDefault()
    if (canNext && phone && details.poisha) check.mutate({ type, receiverPhone: phone, amount: details.poisha })
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <PhoneInput
          label={t(`flows.${type}.receiver`)}
          value={details.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
          error={phoneError}
        />
        <p aria-live="polite" className="flex items-baseline gap-2 text-sm">
          {receiver && !wrongRole && (
            <>
              <span className="font-semibold text-text">{receiver.name}</span>
              <span className="text-text-muted">{t(`roles.${receiver.role}`)}</span>
            </>
          )}
        </p>
      </div>
      <AmountInput
        label={t('transfer.amount')}
        defaultValue={details.amountText}
        onAmountChange={({ text, poisha }) => onChange({ amountText: text, poisha })}
      />
      <Input label={t('transfer.note')} value={details.note} maxLength={50} onChange={(e) => onChange({ note: e.target.value })} />
      {check.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, check.error)}
        </p>
      )}
      <div className="mt-auto">
        <Button type="submit" disabled={!canNext} loading={check.isPending}>
          {t('transfer.next')}
        </Button>
      </div>
    </form>
  )
}

/** Receiver, amount, fee and the total (the biggest thing), before the PIN. */
function PreviewStep({ preview, notice, onNext }: { preview: Preview; notice: string | null; onNext(): void }) {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PartyCard label={t('transfer.to')} party={preview.receiver} />
      <dl className="flex flex-col gap-3">
        <Row label={t('transfer.amount')}>{formatTaka(preview.amount, { lang })}</Row>
        <Row label={t('transfer.fee')}>{formatTaka(preview.fee, { lang })}</Row>
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
          <dt className="text-sm text-text-muted">{t('transfer.total')}</dt>
          <dd className="text-3xl font-semibold tabular-nums text-text">{formatTaka(preview.total, { lang })}</dd>
        </div>
      </dl>
      {notice && (
        <p role="alert" className="text-sm text-danger">
          {notice}
        </p>
      )}
      <div className="mt-auto">
        <Button onClick={onNext}>{t('transfer.next')}</Button>
      </div>
    </div>
  )
}

interface PinStepProps {
  flow: Flow
  preview: Preview
  note: string
  idempotencyKey: string
  onSuccess(receipt: Receipt): void
  onRefused(message: string): void
}

/** The PIN, then the money POST with the flow's Idempotency-Key. The PIN is cleared on every submit. */
function PinStep({ flow, preview, note, idempotencyKey, onSuccess, onRefused }: PinStepProps) {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const navigate = useNavigate()
  const toast = useToast()
  const pinInput = useRef<PinInputHandle>(null)
  const pin = useRef('') // a ref, not state: the PIN is never rendered
  const [length, setLength] = useState(0)
  const [failure, setFailure] = useState<{ message: string; network: boolean } | null>(null)

  const send = useMutation({
    mutationFn: (value: string) =>
      transfer(
        flow.path,
        // What the user saw on Preview: the server's normalised phone and the previewed amount.
        { receiverPhone: preview.receiver.phone ?? '', amount: preview.amount, pin: value, note: note.trim() || undefined },
        idempotencyKey,
      ),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
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
        } else if (BACK_TO_PREVIEW.has(code)) {
          onRefused(message)
        } else {
          // INVALID_PIN (attempts left), NETWORK_ERROR ("Try again", same key) and anything else: stay here.
          setFailure({ message, network: code === 'NETWORK_ERROR' })
          pinInput.current?.focus()
        }
      },
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-text-muted">{preview.receiver.name}</p>
        <p className="text-3xl font-semibold tabular-nums text-text">{formatTaka(preview.total, { lang })}</p>
      </div>
      <PinInput
        ref={pinInput}
        label={t('transfer.pin')}
        error={failure?.message}
        onChange={(value) => {
          pin.current = value
          setLength(value.length)
        }}
      />
      <div className="mt-auto">
        <Button type="submit" disabled={length < PIN_LENGTH} loading={send.isPending}>
          {failure?.network ? t('transfer.tryAgain') : t('transfer.confirm')}
        </Button>
      </div>
    </form>
  )
}

/** "-50500" → "−৳505.00" (out); "+50000" or "50000" → "+৳500.00" (in). formatTaka itself only takes digits. */
function signedTaka(amount: string, lang: Lang) {
  const out = amount.startsWith('-')
  return { out, text: formatTaka(amount.replace(/^[-+]/, ''), { sign: out ? 'out' : 'in', lang }) }
}

/** A receipt: the flow's last step, and the receipt page (`/transactions/:trxId`). */
export function ReceiptView({ receipt }: { receipt: Receipt }) {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const navigate = useNavigate()
  const toast = useToast()
  const headingId = useId()
  const mine = signedTaka(receipt.mine.amount, lang)

  async function share() {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: t('transfer.shareText', { trxId: receipt.trxId }) })
      } catch {
        // the user closed the share sheet
      }
      return
    }
    try {
      await navigator.clipboard.writeText(receipt.trxId)
      toast.show(t('transfer.copied'), 'success')
    } catch {
      toast.show(t('errors.GENERIC'))
    }
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        {/* design-ok: base success colours only this icon (TASTE.md) */}
        <CircleCheck aria-hidden className="size-12 text-success" />
        <h2 id={headingId} className="text-lg font-semibold text-text">
          {t('transfer.success')}
        </h2>
        <p className={`text-3xl font-semibold tabular-nums ${mine.out ? 'text-danger' : 'text-success-dark'}`}>{mine.text}</p>
      </div>
      <dl className="flex flex-col gap-3">
        <Row label={t('transfer.trxId')}>{receipt.trxId}</Row>
        <Row label={t('transfer.from')}>
          <PartyLines party={receipt.from} />
        </Row>
        <Row label={t('transfer.to')}>
          <PartyLines party={receipt.to} />
        </Row>
        <Row label={t('transfer.amount')}>{formatTaka(receipt.amount, { lang })}</Row>
        <Row label={t('transfer.fee')}>{formatTaka(receipt.fee, { lang })}</Row>
        <Row label={t('transfer.balanceAfter')}>{formatTaka(receipt.mine.balanceAfter, { lang })}</Row>
        <Row label={t('transfer.time')}>{formatDateTime(receipt.createdAt, lang)}</Row>
      </dl>
      <div className="mt-auto flex flex-col gap-3">
        <Button onClick={() => void navigate('/')}>{t('transfer.done')}</Button>
        <Button variant="secondary" onClick={() => void share()}>
          <Share2 aria-hidden className="size-5" />
          {t('transfer.share')}
        </Button>
      </div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="text-right text-sm tabular-nums text-text">{children}</dd>
    </div>
  )
}

function PartyLines({ party }: { party: Party }) {
  return (
    <>
      <span className="block">{party.name}</span>
      {party.phone && <span className="block text-text-muted">{party.phone}</span>}
    </>
  )
}

function PartyCard({ label, party }: { label: string; party: Party }) {
  return (
    <Card className="flex flex-col gap-1">
      <p className="text-sm text-text-muted">{label}</p>
      <p className="text-base font-semibold text-text">{party.name}</p>
      {party.phone && <p className="text-sm tabular-nums text-text-muted">{party.phone}</p>}
    </Card>
  )
}
