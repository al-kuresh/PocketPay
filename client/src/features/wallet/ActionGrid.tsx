import { History as HistoryIcon, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import type { TxType } from '../../api/types'
import { FLOWS } from '../transfer/flows'
import { useSession } from '../../stores/session'

// Pressed: the tile shrinks a little (a disabled one doesn't: two pseudo-classes beat active:).
const TILE =
  'flex min-h-11 w-full flex-col items-center gap-2 rounded-2xl px-0 py-2 text-center text-sm text-text transition duration-150 ease-out-quint hover:bg-surface-sunken active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100'
const TILE_ICON = 'flex size-12 items-center justify-center rounded-2xl bg-primary-50'

/** The home's action grid: the role's money flows, then History. */
export function ActionGrid({ actions }: { actions: ReadonlyArray<{ type: TxType; Icon: LucideIcon }> }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const active = useSession((s) => s.user?.status) === 'ACTIVE'
  return (
    // gap-1 + no side padding: "Send Money" (79px at text-sm) stays on one line at 390px, like the other labels.
    <ul className="grid grid-cols-4 gap-1">
      {actions.map(({ type, Icon }) => (
        <li key={type}>
          {/* Disabled, not hidden, while KYC is pending or rejected (design §5). */}
          <button type="button" disabled={!active} onClick={() => void navigate(`/${FLOWS[type].path}`)} className={TILE}>
            <span className={TILE_ICON}>
              <Icon aria-hidden className="size-6 text-primary-dark" />
            </span>
            {t(FLOWS[type].titleKey)}
          </button>
        </li>
      ))}
      <li>
        <Link to="/history" className={TILE}>
          <span className={TILE_ICON}>
            <HistoryIcon aria-hidden className="size-6 text-primary-dark" />
          </span>
          {t('nav.history')}
        </Link>
      </li>
    </ul>
  )
}
