import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost'

const VARIANTS: Record<Variant, string> = {
  // The one primary action per screen: full width, filled, in the thumb zone.
  primary: 'h-12 w-full bg-primary-dark font-semibold text-white hover:bg-primary-darker',
  secondary: 'h-12 w-full border border-border-strong bg-surface font-semibold text-text hover:bg-surface-sunken',
  ghost: 'px-3 text-primary-dark hover:bg-primary-50',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  /** Shows a spinner and blocks clicks (a double tap can't submit twice). */
  loading?: boolean
}

export function Button({ variant = 'primary', loading = false, disabled, type = 'button', className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl text-base transition-colors duration-150 ease-out-quint disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {loading && <LoaderCircle aria-hidden className="size-5 animate-spin" />}
      {children}
    </button>
  )
}
