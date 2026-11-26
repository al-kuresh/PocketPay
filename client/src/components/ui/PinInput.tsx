import { Lock } from 'lucide-react'
import { useId, useImperativeHandle, useRef, useState, type ChangeEvent, type Ref } from 'react'
import { toAsciiDigits } from '../../lib/digits'

export interface PinInputHandle {
  /** Empty the field. The parent calls this after every submit, success or failure. */
  clear(): void
  focus(): void
}

interface PinInputProps {
  label: string
  /** Already translated. */
  error?: string
  onChange?(pin: string): void
  onComplete?(pin: string): void
  disabled?: boolean
  /** A lock icon beside the label (Confirm: the PIN that authorises a payment). */
  lock?: boolean
  autoFocus?: boolean
  ref?: Ref<PinInputHandle>
}

const LENGTH = 5

/**
 * 5 boxes over ONE real `type="password"` input (invisible, on top of the boxes), so paste, the phone's numeric
 * keypad and password-manager behaviour all work. The input is uncontrolled: the PIN is never a React prop,
 * never a DOM attribute and never text. The boxes only know how many digits there are.
 */
export function PinInput({ label, error, onChange, onComplete, disabled, autoFocus, lock = false, ref }: PinInputProps) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [count, setCount] = useState(0)

  useImperativeHandle(
    ref,
    () => ({
      clear() {
        if (inputRef.current) inputRef.current.value = ''
        setCount(0)
        onChange?.('')
      },
      focus() {
        inputRef.current?.focus()
      },
    }),
    [onChange],
  )

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const pin = toAsciiDigits(e.target.value).replace(/\D/g, '').slice(0, LENGTH)
    e.target.value = pin
    setCount(pin.length)
    onChange?.(pin)
    if (pin.length === LENGTH) onComplete?.(pin)
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="flex items-center gap-2 text-sm text-text">
        {lock && <Lock aria-hidden className="size-5 text-primary-dark" />}
        {label}
      </label>
      {/* The five boxes share the full width, like the canvas. */}
      <div className="relative grid w-full grid-cols-5 gap-3 rounded-xl focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-dark">
        {Array.from({ length: LENGTH }, (_, i) => (
          <div
            key={i}
            aria-hidden
            data-filled={i < count}
            className={`flex h-14 items-center justify-center rounded-xl border bg-surface ${error ? 'border-danger' : 'border-border-strong'}`}
          >
            {i < count && <span className="size-3 rounded-full bg-text" />}
          </div>
        ))}
        <input
          ref={inputRef}
          id={id}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={handleChange}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
