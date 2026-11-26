import { useMutation, useQuery } from '@tanstack/react-query'
import { FileCheck, LogOut, Menu, ScrollText, Users, X } from 'lucide-react'
import { Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useMatches } from 'react-router'
import { listKyc } from '../../api/admin'
import { logout } from '../../api/auth'
import { toLangDigits } from '../../lib/digits'
import { useIsDesktop } from '../../lib/media'
import { useLanguage } from '../../stores/language'
import { useSession } from '../../stores/session'
import { Dialog } from '../ui/Dialog'
import { LanguageToggle } from '../ui/LanguageToggle'

// Phase 7a only: Phase 7b adds its own items here.
const ITEMS = [
  { to: '/admin/kyc', key: 'admin.nav.kyc', Icon: FileCheck },
  { to: '/admin/users', key: 'admin.nav.users', Icon: Users },
  { to: '/admin/audit', key: 'admin.nav.audit', Icon: ScrollText },
] as const

/** The route's `handle.title` (an i18n key), from the deepest route that has one. */
function usePageTitle() {
  const { t } = useTranslation()
  const key = useMatches()
    .map((m) => (m.handle as { title?: string } | undefined)?.title)
    .findLast(Boolean)
  return key ? t(key) : ''
}

/** PocketPay, the three pages (KYC review with the pending count), then the language, the admin and Log out. */
function AdminMenu({ onNavigate }: { onNavigate?(): void }) {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const name = useSession((s) => s.user?.name)
  // The badge: GET /admin/kyc answers pendingCount whatever the page; one row is enough.
  const pending = useQuery({ queryKey: ['admin', 'kyc', 'pending'], queryFn: () => listKyc({ status: 'PENDING', limit: 1 }) }).data
    ?.pendingCount
  const out = useMutation({ mutationFn: logout }) // drops the session even if the call fails; RequireAuth then goes to /login

  return (
    <div className="flex flex-1 flex-col gap-6">
      <p className="px-3 font-display text-xl font-semibold text-primary-dark">{t('app.name')}</p>
      <nav aria-label={t('admin.nav.label')}>
        <ul className="flex flex-col gap-1">
          {ITEMS.map(({ to, key, Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex min-h-11 items-center gap-3 rounded-xl px-3 text-base transition duration-150 ease-out-quint ${
                    isActive ? 'bg-primary-50 font-semibold text-primary-dark' : 'text-text hover:bg-surface-sunken'
                  }`
                }
              >
                <Icon aria-hidden className="size-5 shrink-0" />
                {t(key)}
                {key === 'admin.nav.kyc' && !!pending && (
                  <>
                    <span className="sr-only">{`, ${toLangDigits(String(pending), lang)} ${t('admin.nav.pending')}`}</span>
                    <span aria-hidden className="ml-auto min-w-6 rounded-full bg-primary-dark px-2 text-center text-xs font-semibold text-white tabular-nums">
                      {toLangDigits(String(pending), lang)}
                    </span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3 px-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold text-text">{name}</span>
            <span className="text-xs text-text-muted">{t('roles.ADMIN')}</span>
          </div>
          <LanguageToggle tone="surface" />
        </div>
        <button
          type="button"
          onClick={() => out.mutate()}
          disabled={out.isPending}
          className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-base text-text transition duration-150 ease-out-quint hover:bg-surface-sunken disabled:cursor-not-allowed disabled:text-text-muted"
        >
          <LogOut aria-hidden className="size-5 shrink-0" />
          {t('common.logout')}
        </button>
      </div>
    </div>
  )
}

/** The admin panel: a sidebar from lg up; below lg the orange app bar and the same menu in a sheet. */
export function AdminLayout() {
  const { t } = useTranslation()
  const desktop = useIsDesktop()
  const title = usePageTitle()
  const [menuOpen, setMenuOpen] = useState(false)
  const close = () => setMenuOpen(false)

  return (
    <div className="flex min-h-screen bg-canvas">
      {desktop && (
        <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface p-4">
          <AdminMenu />
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {!desktop && (
          // White focus rings on the orange, as in AppShell.
          <header className="bg-primary-dark pt-safe text-white [&_:focus-visible]:outline-white">
            <div className="flex h-16 items-center gap-2 px-6">
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                aria-label={t('admin.nav.menu')}
                aria-haspopup="dialog"
                className="-ml-3 flex min-h-11 min-w-11 items-center justify-center rounded-xl hover:bg-primary-darker"
              >
                <Menu aria-hidden className="size-6" />
              </button>
              <h1 className="flex-1 truncate font-display text-xl font-semibold">{title}</h1>
            </div>
          </header>
        )}
        <main className="flex flex-1 flex-col px-6 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto flex w-full max-w-admin flex-col gap-6">
            {desktop && <h1 className="font-display text-xl font-semibold text-text">{title}</h1>}
            {/* A page's chunk loads inside the layout, so the sidebar stays put. aria-busy: renderPage waits for it. */}
            <Suspense fallback={<div aria-busy="true" className="h-32 animate-pulse rounded-3xl bg-surface-sunken" />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
      {menuOpen && (
        <Dialog title={t('admin.nav.label')} onClose={close} placement="left" className="w-72 max-w-full p-4 pt-safe">
          <button
            type="button"
            onClick={close}
            aria-label={t('admin.nav.close')}
            className="absolute top-4 right-4 flex min-h-11 min-w-11 items-center justify-center rounded-xl text-text hover:bg-surface-sunken"
          >
            <X aria-hidden className="size-6" />
          </button>
          <AdminMenu onNavigate={close} />
        </Dialog>
      )}
    </div>
  )
}
