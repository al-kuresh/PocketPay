import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

const PLACEMENT = {
  // ConfirmDialog, the full-size KYC image.
  center: 'items-center justify-center p-4',
  // The admin menu below lg.
  left: 'items-stretch justify-start',
}

interface DialogProps {
  /** Already translated: the dialog's accessible name (and its heading when `showTitle`). */
  title: string
  showTitle?: boolean
  onClose(): void
  placement?: keyof typeof PLACEMENT
  /** The panel's size, padding and shape. */
  className?: string
  children: ReactNode
}

/**
 * A modal: focus moves in and stays in (Tab wraps), Esc and the backdrop close it, and focus goes back to whatever
 * had it before (the button that opened it). Rendered into <body>, over everything.
 */
export function Dialog({ title, showTitle = false, onClose, placement = 'center', className = '', children }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel.current)?.focus()
    return () => opener?.focus()
  }, [])

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !panel.current) return
    const all = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (all.length === 0) return e.preventDefault()
    const first = all[0]
    const last = all[all.length - 1]
    const at = document.activeElement
    if (e.shiftKey && (at === first || !panel.current.contains(at))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (at === last || !panel.current.contains(at))) {
      e.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div className={`fixed inset-0 z-30 flex ${PLACEMENT[placement]}`} onKeyDown={onKeyDown}>
      <div aria-hidden className="absolute inset-0 bg-text/50" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={showTitle ? titleId : undefined}
        aria-label={showTitle ? undefined : title}
        tabIndex={-1}
        className={`relative flex flex-col bg-surface shadow-lg ${className}`}
      >
        {showTitle && (
          <h2 id={titleId} className="font-display text-xl font-semibold text-text">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>,
    document.body,
  )
}
