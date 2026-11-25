import { useId, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { takaToPoisha } from '../../lib/money'

export interface AmountResult {
  /** What the user typed, as typed (to restore the field, e.g. coming back from Preview). */
  text: string
  /** The parsed amount in poisha, or null when empty or invalid. */
  poisha: string | null
  /** An i18n key when the text isn't a valid amount; null when valid or still empty. */
  error: string | null
}

interface AmountInputProps {
  label: string
  /** Taka as the user typed it, e.g. when coming back from Preview. */
  defaultValue?: string
  onAmountChange(result: AmountResult): void
  autoFocus?: boolean
}

/** The amount in taka, typed in either digit set, as a screen's hero. Parsed only by takaToPoisha (never a float). */
export function AmountInput({ label, defaultValue = '', onAmountChange, autoFocus }: AmountInputProps) {
  const { t } = useTranslation()
  const id = useId()
  const [error, setError] = useState<string | null>(null)

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const empty = e.target.value.trim() === ''
    const poisha = empty ? null : takaToPoisha(e.target.value)
    const next = !empty && poisha === null ? 'amount.invalid' : null
    setError(next)
    onAmountChange({ text: e.target.value, poisha, error: next })
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm text-text">
        {label}
      </label>
      <div
        className={`flex items-baseline gap-2 rounded-xl border bg-surface px-4 py-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-dark ${error ? 'border-danger' : 'border-border-strong'}`}
      >
        <span aria-hidden className="text-xl font-semibold text-text-muted">
          ৳
        </span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          defaultValue={defaultValue}
          autoFocus={autoFocus}
          onChange={handleChange}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="w-full min-w-0 bg-transparent text-3xl font-semibold tabular-nums text-text outline-none placeholder:text-text-muted"
        />
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {t(error)}
        </p>
      )}
    </div>
  )
}
