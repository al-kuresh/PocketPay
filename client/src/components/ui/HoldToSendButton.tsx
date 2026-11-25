import { LoaderCircle } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Stitch } from './Stitch'

// Keep in step with --duration-hold in index.css (the fill's sweep).
const HOLD_MS = 1200

interface HoldToSendButtonProps {
  /** Already translated, e.g. "Hold to send ৳505.00". Also the accessible name. */
  label: string
  /** Not ready (the PIN isn't complete). */
  disabled?: boolean
  /** The money POST is in flight: a spinner, aria-busy, and no new hold. */
  loading?: boolean
  /** Called once per completed hold, never on a tap. */
  onHold(): void
}

const holdKey = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' '

/**
 * The money flow's send button (TASTE.md): press and hold 1.2 s, by pointer or with Enter/Space held. Letting go,
 * a pointer cancel or losing focus resets it. There is no onClick at all, so a tap or a click can't send.
 */
export function HoldToSendButton({ label, disabled = false, loading = false, onHold }: HoldToSendButtonProps) {
  const { t } = useTranslation()
  const hintId = useId()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [holding, setHolding] = useState(false)
  const off = disabled || loading

  useEffect(() => () => clearTimeout(timer.current), [])

  function start() {
    if (off || timer.current !== undefined) return
    setHolding(true)
    timer.current = setTimeout(() => {
      timer.current = undefined
      if ('vibrate' in navigator) navigator.vibrate(30)
      onHold()
    }, HOLD_MS)
  }

  function stop() {
    clearTimeout(timer.current)
    timer.current = undefined
    setHolding(false)
  }

  const content = (
    <>
      {loading && <LoaderCircle aria-hidden className="size-5 animate-spin" />}
      {holding && !loading ? t('transfer.keepHolding') : label}
    </>
  )

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        disabled={off}
        aria-label={label}
        aria-busy={loading || undefined}
        aria-describedby={hintId}
        data-holding={holding || loading}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId) // the hold survives the finger sliding off the button
          start()
        }}
        onPointerUp={stop}
        onPointerCancel={stop}
        onKeyDown={(e) => {
          if (!holdKey(e)) return
          e.preventDefault()
          if (!e.repeat) start()
        }}
        onKeyUp={(e) => {
          if (holdKey(e)) stop()
        }}
        onBlur={stop}
        onContextMenu={(e) => e.preventDefault()} // a long press would open the phone's menu
        className={`relative flex h-14 w-full touch-none select-none items-center justify-center overflow-hidden rounded-2xl text-base font-semibold disabled:cursor-not-allowed ${disabled && !loading ? 'bg-surface-sunken text-text-muted' : 'bg-primary-50 text-primary-darker'}`}
      >
        <Stitch
          shape="rect"
          className={`absolute inset-0 size-full ${disabled && !loading ? 'stroke-thread-muted' : 'stroke-thread-dark'}`}
        />
        <span className="flex items-center gap-2">{content}</span>
        {/* The same label in white on the orange fill, revealed left to right as the hold runs (the hold-fill utility). */}
        <span
          aria-hidden
          data-fill
          className="hold-fill absolute inset-0 flex items-center justify-center gap-2 bg-primary-dark text-white"
        >
          {content}
        </span>
      </button>
      <p id={hintId} className="text-center text-sm text-text-muted">
        {t('transfer.holdHint')}
      </p>
    </div>
  )
}
