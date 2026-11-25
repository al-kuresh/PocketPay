import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BottomNav } from './BottomNav'
import { MobileShell } from './MobileShell'

interface AppShellProps {
  /** Already translated. */
  title?: string
  onBack?(): void
  /** Show the bottom nav (Home · History · Profile). */
  nav?: boolean
  /** Something on the right of the header, e.g. the language toggle. */
  headerEnd?: ReactNode
  children: ReactNode
}

/** MobileShell + a header (back, title, extra) + the page + an optional bottom nav. */
export function AppShell({ title, onBack, nav = false, headerEnd, children }: AppShellProps) {
  const { t } = useTranslation()
  return (
    <MobileShell>
      {(title || onBack || headerEnd) && (
        <header className="border-b border-border bg-surface pt-safe">
          <div className="flex h-16 items-center gap-2 px-6">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label={t('common.back')}
                className="-ml-3 flex min-h-11 min-w-11 items-center justify-center rounded-xl text-text hover:bg-surface-sunken"
              >
                <ArrowLeft aria-hidden className="size-6" />
              </button>
            )}
            {title && <h1 className="flex-1 text-lg font-semibold text-text">{title}</h1>}
            {headerEnd && <div className="ml-auto">{headerEnd}</div>}
          </div>
        </header>
      )}
      <main className="flex flex-1 flex-col gap-6 px-6 py-6">{children}</main>
      {nav && (
        <>
          {/* Room for the fixed nav, so it never covers the end of the page. */}
          <div aria-hidden className="shrink-0 pb-safe">
            <div className="h-16" />
          </div>
          <BottomNav />
        </>
      )}
    </MobileShell>
  )
}
