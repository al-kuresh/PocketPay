import { Share2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Receipt } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Stitch } from '../../components/ui/Stitch'
import { useToast } from '../../components/ui/toast-context'
import { copyText } from '../../lib/clipboard'
import { formatDateTime } from '../../lib/dates'
import { formatTaka } from '../../lib/money'
import { useLanguage } from '../../stores/language'

/** "to Karim H*** · 01800000003" when the money left me, "from …" when it reached me. The name is its own element. */
export function Counterparty({ receipt }: { receipt: Receipt }) {
  const { t } = useTranslation()
  const out = receipt.mine.amount.startsWith('-')
  const party = out ? receipt.to : receipt.from
  return (
    <p className="text-base tabular-nums">
      {t(out ? 'transfer.sentTo' : 'transfer.receivedFrom')} <span>{party.name}</span>
      {party.phone && ` · ${party.phone}`}
    </p>
  )
}

/**
 * The receipt card (the Sent screen and the receipt page): TrxID, time, fee, what left or reached my wallet (signed
 * and coloured: "-50500" → "−৳505.00", "+50000" or "50000" → "+৳500.00"), the stitched tear line, and the new
 * balance as the card's hero. It sits on the canvas tone (the notches are that colour).
 */
export function ReceiptCard({ receipt }: { receipt: Receipt }) {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const out = receipt.mine.amount.startsWith('-')
  return (
    <div className="relative rounded-3xl border border-border bg-surface">
      <dl className="flex flex-col gap-3 p-6 pb-4">
        <Row label={t('transfer.trxId')}>
          <span className="font-semibold">{receipt.trxId}</span>
        </Row>
        <Row label={t('transfer.time')}>{formatDateTime(receipt.createdAt, lang)}</Row>
        <Row label={t('transfer.fee')}>{formatTaka(receipt.fee, { lang })}</Row>
        <Row label={t(out ? 'transfer.totalPaid' : 'transfer.received')} tone={out ? 'text-danger' : 'text-success-dark'}>
          {formatTaka(receipt.mine.amount.replace(/^[-+]/, ''), { sign: out ? 'out' : 'in', lang })}
        </Row>
      </dl>
      {/* The receipt's tear: a notch at each edge (in the page colour) and the stitched line between them. */}
      <div aria-hidden className="relative h-6">
        <span className="absolute -left-3 top-0 size-6 rounded-full border border-border bg-canvas" />
        <Stitch shape="line" className="absolute inset-x-6 top-0 h-6 stroke-thread-muted" />
        <span className="absolute -right-3 top-0 size-6 rounded-full border border-border bg-canvas" />
      </div>
      <dl className="p-6 pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-base text-text-muted">{t('transfer.balanceAfter')}</dt>
          <dd className="font-amount text-3xl font-semibold text-text">{formatTaka(receipt.mine.balanceAfter, { lang })}</dd>
        </div>
      </dl>
    </div>
  )
}

function Row({ label, tone = 'text-text', children }: { label: string; tone?: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-base text-text-muted">{label}</dt>
      <dd className={`text-right text-base tabular-nums ${tone}`}>{children}</dd>
    </div>
  )
}

/** Share the TrxID: the share sheet where there is one, else copy it (works on plain http too), else show it to copy by hand. */
export function ShareButton({ trxId }: { trxId: string }) {
  const { t } = useTranslation()
  const toast = useToast()

  async function share() {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: t('transfer.shareText', { trxId }) })
        return
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return // the user closed the share sheet
        // anything else (NotAllowedError, no share target): copy instead
      }
    }
    if (await copyText(trxId)) toast.show(t('transfer.copied'), 'success')
    else toast.show(t('transfer.copyByHand', { trxId })) // the user can still read it off the toast
  }

  return (
    <Button variant="secondary" onClick={() => void share()}>
      <Share2 aria-hidden className="size-5" />
      {t('transfer.share')}
    </Button>
  )
}
