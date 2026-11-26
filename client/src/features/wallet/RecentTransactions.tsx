import { useQuery } from '@tanstack/react-query'
import { ReceiptText } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { history } from '../../api/transactions'
import type { HistoryItem } from '../../api/types'
import { EmptyState } from '../../components/ui/EmptyState'
import { Initials } from '../../components/ui/Initials'
import { Skeleton } from '../../components/ui/Skeleton'
import { errorMessage } from '../../i18n/errors'
import { formatWhen } from '../../lib/dates'
import { formatTaka } from '../../lib/money'
import { useLanguage } from '../../stores/language'

/** The home's 5 latest transactions, with "See all". */
export function RecentTransactions() {
  const { t } = useTranslation()
  const recent = useQuery({ queryKey: ['history', { limit: 5 }], queryFn: () => history({ limit: 5 }) })
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id={headingId} className="font-display text-lg font-semibold text-text">
          {t('home.recent')}
        </h2>
        <Link to="/history" className="flex min-h-11 min-w-11 items-center justify-end text-sm font-semibold text-primary-dark">
          {t('home.seeAll')}
        </Link>
      </div>
      {recent.isPending ? (
        <HistorySkeleton />
      ) : recent.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, recent.error)}
        </p>
      ) : recent.data.items.length === 0 ? (
        <EmptyState icon={ReceiptText} title={t('home.empty')} message={t('home.emptyBody')} />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-3xl border border-border bg-surface px-4">
          {recent.data.items.map((item) => (
            <HistoryRow key={item.trxId} item={item} />
          ))}
        </ul>
      )}
    </section>
  )
}

export function HistorySkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </div>
  )
}

/** One history row: initials tinted by direction, who, what and when ("7:42 pm", "Yesterday", "23 Nov"); the amount signed (+ in, − out) and coloured. Tapping it opens the receipt. */
export function HistoryRow({ item }: { item: HistoryItem }) {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const out = item.direction === 'OUT'
  return (
    <li>
      <Link
        to={`/transactions/${item.trxId}`}
        className="flex min-h-11 items-center gap-3 py-3 transition-colors duration-150 ease-out-quint hover:bg-surface-sunken"
      >
        <Initials name={item.counterparty.name} incoming={!out} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-base text-text">{item.counterparty.name}</span>
          <span className="text-sm text-text-muted">
            {t(`flows.${item.type}.title`)} · {formatWhen(item.createdAt, lang)}
          </span>
        </span>
        <span className={`shrink-0 font-display text-base font-semibold tabular-nums ${out ? 'text-danger' : 'text-success-dark'}`}>
          {formatTaka(item.amount, { sign: out ? 'out' : 'in', lang })}
        </span>
      </Link>
    </li>
  )
}
