import { History as HistoryIcon, House, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'

const ITEMS = [
  { to: '/', key: 'nav.home', Icon: House },
  { to: '/history', key: 'nav.history', Icon: HistoryIcon },
  { to: '/profile', key: 'nav.profile', Icon: User },
] as const

/** Home · History · Profile, fixed to the bottom of the phone frame, clear of the home indicator (pb-safe). */
export function BottomNav() {
  const { t } = useTranslation()
  return (
    <nav aria-label={t('nav.label')} className="fixed inset-x-0 bottom-0 z-10 mx-auto w-full max-w-phone border-t border-border bg-surface pb-safe">
      <ul className="flex">
        {ITEMS.map(({ to, key, Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end
              className={({ isActive }) =>
                `flex h-16 flex-col items-center justify-center gap-1 text-xs ${isActive ? 'font-semibold text-primary-dark' : 'text-text-muted'}`
              }
            >
              <Icon aria-hidden className="size-6" />
              {t(key)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
