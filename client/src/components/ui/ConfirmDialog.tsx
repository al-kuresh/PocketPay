import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { toLangDigits } from '../../lib/digits'
import { useLanguage } from '../../stores/language'
import { Button } from './Button'
import { Dialog } from './Dialog'

/** The server's rule for a rejection or freeze reason (5–200 characters after trimming). */
const isValidReason = (reason: string) => reason.trim().length >= 5 && reason.trim().length <= 200

interface ReasonFieldProps {
  value: string
  onChange(value: string): void
  /** Chips that fill the field with a ready-made reason. */
  quick?: Array<{ label: string; text: string }>
}

/** A textarea for the reason, with the 5–200 hint and a live counter. */
export function ReasonField({ value, onChange, quick = [] }: ReasonFieldProps) {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm text-text">
        {t('admin.reason.label')}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={200}
        rows={3}
        aria-describedby={`${id}-note`}
        className="rounded-xl border border-border-strong bg-surface px-4 py-3 text-base text-text"
      />
      <div id={`${id}-note`} className="flex justify-between gap-3 text-sm text-text-muted">
        <span>{t('admin.reason.hint')}</span>
        <span className="tabular-nums">{t('admin.reason.count', { n: toLangDigits(String(value.length), lang) })}</span>
      </div>
      {quick.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text">{t('admin.kyc.quick.label')}</p>
          <div className="flex flex-wrap gap-2">
            {quick.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => onChange(q.text)}
                className="min-h-11 rounded-full border border-border-strong bg-surface px-4 text-sm text-text transition duration-150 ease-out-quint hover:bg-primary-50 active:scale-95"
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface ConfirmDialogProps {
  /** Already translated, naming the person: "Approve Jamal Uddin?". */
  title: string
  message?: string
  confirmLabel: string
  /** The request is on its way: both buttons off, Esc and the backdrop do nothing. */
  busy?: boolean
  /** Set to ask for a reason (5–200 characters); confirm stays off until it is valid. */
  reason?: string
  onReasonChange?(reason: string): void
  quickReasons?: ReasonFieldProps['quick']
  onConfirm(): void
  onCancel(): void
}

/** Every admin decision goes through this (TASTE.md, Admin panel). Focus is trapped; it returns to the opener. */
export function ConfirmDialog({ title, message, confirmLabel, busy = false, reason, onReasonChange, quickReasons, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useTranslation()
  const needsReason = reason !== undefined
  return (
    <Dialog title={title} showTitle onClose={busy ? () => {} : onCancel} className="max-h-full w-full max-w-md gap-4 overflow-y-auto rounded-3xl p-6">
      {message && <p className="text-sm text-text">{message}</p>}
      {needsReason && <ReasonField value={reason} onChange={(r) => onReasonChange?.(r)} quick={quickReasons} />}
      {/* Cancel first: without a reason field it gets the first focus (the safe choice). Confirm sits at the bottom on a phone. */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button loading={busy} disabled={needsReason && !isValidReason(reason)} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}
