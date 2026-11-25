import { useQuery } from '@tanstack/react-query'
import { Banknote, Eye, EyeOff, History as HistoryIcon, ReceiptText, Send, Store } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { me } from '../../api/auth'
import { history } from '../../api/transactions'
import type { HistoryItem } from '../../api/types'
import { AppShell } from '../../components/layout/AppShell'
import { EmptyState } from '../../components/ui/EmptyState'
import { LanguageToggle } from '../../components/ui/LanguageToggle'
import { Skeleton } from '../../components/ui/Skeleton'
import { StatusBanner } from '../../components/ui/StatusBanner'
import { FLOWS } from '../../features/transfer/flows'
import { errorMessage } from '../../i18n/errors'
import { formatDateTime } from '../../lib/dates'
import { formatTaka } from '../../lib/money'
import { useLanguage, type Lang } from '../../stores/language'
import { useSession } from '../../stores/session'

const MONEY_ACTIONS = [
  { type: 'SEND_MONEY', Icon: Send },
  { type: 'CASH_OUT', Icon: Banknote },
  { type: 'PAYMENT', Icon: Store },
] as const

const TILE =
  'flex min-h-11 w-full flex-col items-center gap-2 rounded-xl p-2 text-center text-sm text-text transition-colors duration-150 ease-out-quint hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50'
const TILE_ICON = 'flex size-12 items-center justify-center rounded-full bg-primary-50'

/** The customer's home: balance (hidden until tapped), the action grid, the 5 latest transactions. */
export function Home() {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const navigate = useNavigate()
  const status = useSession((s) => s.user?.status)
  const active = status === 'ACTIVE'
  const wallet = useQuery({ queryKey: ['me'], queryFn: me })
  const recent = useQuery({ queryKey: ['history', { limit: 5 }], queryFn: () => history({ limit: 5 }) })
  const [shown, setShown] = useState(false)
  const recentId = useId()
  const balance = wallet.data?.wallet?.balance

  return (
    <AppShell title={t('nav.home')} nav headerEnd={<LanguageToggle />}>
      {status === 'PENDING_KYC' && <StatusBanner kind="PENDING_KYC" />}
      {status === 'REJECTED' && <StatusBanner kind="REJECTED" />}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? undefined : t('home.showBalance')}
          // design-ok: balance card
          className="flex flex-col gap-2 rounded-2xl bg-linear-to-br from-primary to-primary-light p-6 text-left text-white"
        >
          <span className="flex items-center justify-between text-lg font-semibold">
            {t('home.balance')}
            {shown ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
          </span>
          {!shown ? (
            <span className="text-4xl font-semibold tabular-nums">৳ ••••</span>
          ) : balance !== undefined ? (
            <span className="text-4xl font-semibold tabular-nums">{formatTaka(balance, { lang })}</span>
          ) : (
            <Skeleton className="h-10 w-40" />
          )}
        </button>
        {wallet.isError && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(t, wallet.error)}
          </p>
        )}
      </div>

      <ul className="grid grid-cols-4 gap-2">
        {MONEY_ACTIONS.map(({ type, Icon }) => (
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

      <section aria-labelledby={recentId} className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 id={recentId} className="text-lg font-semibold text-text">
            {t('home.recent')}
          </h2>
          <Link to="/history" className="flex min-h-11 items-center text-sm text-primary-dark">
            {t('home.seeAll')}
          </Link>
        </div>
        {recent.isPending ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : recent.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(t, recent.error)}
          </p>
        ) : recent.data.items.length === 0 ? (
          <EmptyState icon={ReceiptText} title={t('home.empty')} message={t('home.emptyBody')} />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {recent.data.items.map((item) => (
              <RecentItem key={item.trxId} item={item} lang={lang} />
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  )
}

function RecentItem({ item, lang }: { item: HistoryItem; lang: Lang }) {
  const { t } = useTranslation()
  const out = item.direction === 'OUT'
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-sm font-semibold text-text">{item.counterparty.name}</span>
        <span className="text-sm text-text-muted">
          {t(`flows.${item.type}.title`)} · {formatDateTime(item.createdAt, lang)}
        </span>
      </div>
      <span className={`shrink-0 text-sm font-semibold tabular-nums ${out ? 'text-danger' : 'text-success-dark'}`}>
        {formatTaka(item.amount, { sign: out ? 'out' : 'in', lang })}
      </span>
    </li>
  )
}
