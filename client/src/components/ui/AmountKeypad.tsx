import { Delete } from 'lucide-react'
import { useId, ViewTransition, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { toLangDigits } from '../../lib/digits'
import { editAmount, formatTaka } from '../../lib/money'
import { useLanguage } from '../../stores/language'

// The amount is a string the user edits (editAmount's rules); only takaToPoisha turns it into money.

interface AmountFieldProps {
  /** Already translated. */
  label: string
  /** ASCII digits, as editAmount leaves them. */
  text: string
  onTextChange(text: string): void
  ref?: Ref<HTMLInputElement>
}

/** The amount as the screen's hero, in the language's digits. The keypad is its keyboard; a physical keyboard still types here. */
export function AmountField({ label, text, onTextChange, ref }: AmountFieldProps) {
  const id = useId()
  const lang = useLanguage((s) => s.lang)
  return (
    <div className="flex flex-col items-center gap-2">
      <label htmlFor={id} className="text-sm text-text-muted">
        {label}
      </label>
      {/* The shared amount: a transition carries it on to Confirm's total and the Sent screen. */}
      <ViewTransition name="amount">
        <div className="flex items-baseline justify-center gap-2">
          <span aria-hidden className="font-amount text-xl font-semibold text-text-muted">
            ৳
          </span>
          <input
            ref={ref}
            id={id}
            inputMode="none" // the phone keyboard never opens: the keypad below is the keyboard
            autoComplete="off"
            placeholder={toLangDigits('0', lang)}
            value={toLangDigits(text, lang)}
            size={text.length || 1} // the width where field-sizing isn't supported yet
            onChange={(e) => onTextChange(editAmount(text, e.target.value))}
            // h-16: field-sizing alone makes the box 119px tall (Anek's Bangla ascent); 64px fits the 64px digits and the screen.
            className="field-sizing-content h-16 min-w-0 rounded-xl bg-transparent text-center font-amount text-hero font-semibold text-text placeholder:text-text-muted"
          />
        </div>
      </ViewTransition>
    </div>
  )
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'] as const
const KEY =
  'flex h-14 items-center justify-center rounded-2xl bg-surface-sunken font-display text-xl text-text transition duration-150 ease-out-quint hover:bg-border active:scale-95'

/** 1–9, the point, 0 and delete, in the language's digits. */
export function AmountKeypad({ text, onTextChange }: Omit<AmountFieldProps, 'label' | 'ref'>) {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  return (
    <div role="group" aria-label={t('amount.keypad')} className="grid grid-cols-3 gap-2">
      {KEYS.map((k) => (
        <button key={k} type="button" onClick={() => onTextChange(editAmount(text, text + k))} className={KEY}>
          {toLangDigits(k, lang)}
        </button>
      ))}
      <button type="button" aria-label={t('amount.delete')} onClick={() => onTextChange(text.slice(0, -1))} className={KEY}>
        <Delete aria-hidden className="size-6" />
      </button>
    </div>
  )
}

const CHIPS = ['500', '1000', '2000'] as const // taka

/** Quick amounts: a tap sets the amount (it doesn't add to it). */
export function AmountChips({ onTextChange }: Pick<AmountFieldProps, 'onTextChange'>) {
  const lang = useLanguage((s) => s.lang)
  return (
    <div className="flex justify-center gap-3">
      {CHIPS.map((taka) => (
        <button
          key={taka}
          type="button"
          onClick={() => onTextChange(taka)}
          className="min-h-11 rounded-full border border-thread bg-primary-50 px-4 font-display text-sm font-semibold tabular-nums text-primary-darker transition duration-150 ease-out-quint active:scale-95"
        >
          {formatTaka(`${taka}00`, { lang }).slice(0, -3) /* ৳1,000.00 → ৳1,000: chips are whole taka */}
        </button>
      ))}
    </div>
  )
}
