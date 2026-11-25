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
  /** The orange block the app bar flows into (the home balance). */
  hero?: ReactNode
  children: ReactNode
}

// White focus rings on the orange (the global ring is primary-dark, invisible here).
const ON_BRAND = 'bg-primary-dark text-white [&_:focus-visible]:outline-white'

/** MobileShell + an orange app bar (back, title, extra) + an optional hero + the page + an optional bottom nav. */
export function AppShell({ title, onBack, nav = false, headerEnd, hero, children }: AppShellProps) {
  const { t } = useTranslation()
  return (
    <MobileShell>
      {(title || onBack || headerEnd) && (
        <header className={`${ON_BRAND} pt-safe`}>
          <div className="flex h-16 items-center gap-2 px-6">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label={t('common.back')}
                className="-ml-3 flex min-h-11 min-w-11 items-center justify-center rounded-xl text-white hover:bg-primary-darker"
              >
                <ArrowLeft aria-hidden className="size-6" />
              </button>
            )}
            {title && <h1 className="flex-1 truncate text-lg font-semibold text-white">{title}</h1>}
            {headerEnd && <div className="ml-auto">{headerEnd}</div>}
          </div>
        </header>
      )}
      {hero && <div className={`${ON_BRAND} rounded-b-3xl px-6 pt-2 pb-8`}>{hero}</div>}
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
