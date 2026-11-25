import { useId, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { takaToPoisha } from '../../lib/money'

export interface AmountResult {
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

/** The amount in taka, typed in either digit set. Parsed only by takaToPoisha (never a float). */
export function AmountInput({ label, defaultValue = '', onAmountChange, autoFocus }: AmountInputProps) {
  const { t } = useTranslation()
  const id = useId()
  const [error, setError] = useState<string | null>(null)

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const empty = e.target.value.trim() === ''
    const poisha = empty ? null : takaToPoisha(e.target.value)
    const next = !empty && poisha === null ? 'amount.invalid' : null
    setError(next)
    onAmountChange({ poisha, error: next })
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm text-text">
        {label}
      </label>
      <div
        className={`flex h-12 items-center gap-2 rounded-xl border bg-surface px-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-dark ${error ? 'border-danger' : 'border-border-strong'}`}
      >
        <span aria-hidden className="text-3xl font-semibold text-text">
          ৳
        </span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          defaultValue={defaultValue}
          autoFocus={autoFocus}
          onChange={handleChange}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="w-full min-w-0 bg-transparent text-3xl font-semibold tabular-nums text-text outline-none"
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
