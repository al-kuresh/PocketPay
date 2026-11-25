import { CircleAlert, CircleCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type ToastApi, type ToastTone } from './toast-context'

const SHOW_FOR = 4000

/** One toast at a time, above the bottom nav. The live region is always in the DOM so screen readers announce it. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const api = useMemo<ToastApi>(
    () => ({
      show(message, tone = 'error') {
        clearTimeout(timer.current)
        setToast({ message, tone })
        timer.current = setTimeout(() => setToast(null), SHOW_FOR)
      },
    }),
    [],
  )
  useEffect(() => () => clearTimeout(timer.current), [])

  const Icon = toast?.tone === 'success' ? CircleCheck : CircleAlert
  return (
    <ToastContext value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-16 z-20 mx-auto flex w-full max-w-phone justify-center px-6 pb-4"
      >
        {toast && (
          <div className="flex items-center gap-2 rounded-xl bg-text px-4 py-3 text-sm text-white shadow-lg">
            <Icon aria-hidden className="size-5 shrink-0" />
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext>
  )
}
