import { History as HistoryIcon, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import type { TxType } from '../../api/types'
import { FLOWS } from '../transfer/flows'
import { useSession } from '../../stores/session'

const TILE =
  'flex min-h-11 w-full flex-col items-center gap-2 rounded-xl p-2 text-center text-sm text-text transition-colors duration-150 ease-out-quint hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50'
const TILE_ICON = 'flex size-12 items-center justify-center rounded-full bg-primary-50'

/** The home's action grid: the role's money flows, then History. */
export function ActionGrid({ actions }: { actions: ReadonlyArray<{ type: TxType; Icon: LucideIcon }> }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const active = useSession((s) => s.user?.status) === 'ACTIVE'
  return (
    <ul className="grid grid-cols-4 gap-2">
      {actions.map(({ type, Icon }) => (
        <li key={type}>
          {/* Disabled, not hidden, while KYC is pending or rejected (design §5). */}
          <button type="button" disabled={!active} onClick={() => void navigate(`/${FLOWS[type].path}`)} className={TILE}>
            <span className={TILE_ICON}>
              <Icon aria-hidden className="size-6 text-primary" />
            </span>
            {t(FLOWS[type].titleKey)}
          </button>
        </li>
      ))}
      <li>
        <Link to="/history" className={TILE}>
          <span className={TILE_ICON}>
            <HistoryIcon aria-hidden className="size-6 text-primary" />
          </span>
          {t('nav.history')}
        </Link>
      </li>
    </ul>
  )
}
