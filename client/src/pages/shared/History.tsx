import { useInfiniteQuery } from '@tanstack/react-query'
import { ReceiptText } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { history } from '../../api/transactions'
import { AppShell } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input } from '../../components/ui/Input'
import { HistoryRow, HistorySkeleton } from '../../features/wallet/RecentTransactions'
import { errorMessage } from '../../i18n/errors'
import { dhakaToday } from '../../lib/dates'

const TYPES = ['SEND_MONEY', 'CASH_IN', 'CASH_OUT', 'PAYMENT', 'FLOAT_TOPUP'] as const

/** Every transaction, newest first, a page at a time (`nextCursor`). Filters: type, and a date range in Dhaka days. */
export function History() {
  const { t } = useTranslation()
  const typeId = useId()
  // '' = no filter. Dates are the inputs' own YYYY-MM-DD, which the API reads as Dhaka days.
  const [filters, setFilters] = useState({ type: '', from: '', to: '' })
  const today = dhakaToday()
  const list = useInfiniteQuery({
    queryKey: ['history', 'list', filters],
    queryFn: ({ pageParam }) =>
      history({ cursor: pageParam, type: filters.type || undefined, from: filters.from || undefined, to: filters.to || undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const items = list.data?.pages.flatMap((page) => page.items) ?? []
  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch }))

  return (
    <AppShell title={t('nav.history')} nav>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <label htmlFor={typeId} className="text-sm text-text">
            {t('history.type')}
          </label>
          <select
            id={typeId}
            value={filters.type}
            onChange={(e) => set({ type: e.target.value })}
            className="h-12 rounded-xl border border-border-strong bg-surface px-4 text-base text-text"
          >
            <option value="">{t('history.all')}</option>
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`flows.${type}.title`)}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label={t('history.from')} type="date" value={filters.from} max={filters.to || today} onChange={(e) => set({ from: e.target.value })} />
          <Input label={t('history.to')} type="date" value={filters.to} min={filters.from || undefined} max={today} onChange={(e) => set({ to: e.target.value })} />
        </div>
      </div>

      {list.isPending ? (
        <HistorySkeleton />
      ) : !list.data ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, list.error)}
        </p>
      ) : items.length === 0 ? (
        <EmptyState icon={ReceiptText} title={t('history.empty')} message={t('history.emptyBody')} />
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col divide-y divide-border">
            {items.map((item) => (
              <HistoryRow key={item.trxId} item={item} />
            ))}
          </ul>
          {/* A failed "Load more" keeps the pages already shown. */}
          {list.isFetchNextPageError && (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(t, list.error)}
            </p>
          )}
          {list.hasNextPage && (
            <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              {t('history.loadMore')}
            </Button>
          )}
        </div>
      )}
    </AppShell>
  )
}
