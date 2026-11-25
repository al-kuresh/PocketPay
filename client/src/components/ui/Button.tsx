import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost'

/** `on` while usable (or loading: it stays orange behind the spinner), `off` when disabled: grey, not a paler orange. */
const VARIANTS: Record<Variant, { base: string; on: string; off: string }> = {
  // The one primary action per screen: full width, filled, in the thumb zone.
  primary: {
    base: 'h-14 w-full rounded-2xl font-semibold',
    on: 'bg-primary-dark text-white hover:bg-primary-darker active:scale-95',
    off: 'bg-surface-sunken text-text-muted',
  },
  secondary: {
    base: 'h-14 w-full rounded-2xl border bg-surface font-semibold',
    on: 'border-border-strong text-text hover:bg-surface-sunken active:scale-95',
    off: 'border-border text-text-muted',
  },
  ghost: { base: 'rounded-xl px-3', on: 'text-primary-dark hover:bg-primary-50', off: 'text-text-muted' },
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  /** Shows a spinner and blocks clicks (a double tap can't submit twice). */
  loading?: boolean
}

export function Button({ variant = 'primary', loading = false, disabled, type = 'button', className = '', children, ...rest }: ButtonProps) {
  const v = VARIANTS[variant]
  const off = disabled && !loading
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 text-base transition duration-150 ease-out-quint disabled:cursor-not-allowed ${v.base} ${off ? v.off : v.on} ${className}`}
      {...rest}
    >
      {loading && <LoaderCircle aria-hidden className="size-5 animate-spin" />}
      {children}
    </button>
  )
}
