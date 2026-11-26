import { useInfiniteQuery } from '@tanstack/react-query'
import { ReceiptText } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { history } from '../../api/transactions'
import type { HistoryItem, Role } from '../../api/types'
import { AppShell } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input } from '../../components/ui/Input'
import { HistoryRow, HistorySkeleton } from '../../features/wallet/RecentTransactions'
import { errorMessage } from '../../i18n/errors'
import { dhakaToday } from '../../lib/dates'
import { useSession } from '../../stores/session'

// Only the types a role can be part of (server flow table), so the filter never offers a list that is always empty.
const TYPES: Record<Role, ReadonlyArray<HistoryItem['type']>> = {
  CUSTOMER: ['SEND_MONEY', 'CASH_OUT', 'PAYMENT', 'CASH_IN'],
  AGENT: ['CASH_IN', 'CASH_OUT', 'FLOAT_TOPUP'],
  MERCHANT: ['PAYMENT'],
  ADMIN: [],
}

const CHIP =
  // relative: the sr-only radio is absolute; inside a chip it scrolls (and clips) with it instead of widening the page.
  'relative flex min-h-11 shrink-0 cursor-pointer items-center rounded-full border border-border-strong bg-surface px-4 text-sm text-text transition duration-150 ease-out-quint active:scale-95 has-checked:border-primary-dark has-checked:bg-primary-50 has-checked:font-semibold has-checked:text-primary-darker has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary-dark'

/** Every transaction, newest first, a page at a time (`nextCursor`). Filters: type, and a date range in Dhaka days. */
export function History() {
  const { t } = useTranslation()
  const role = useSession((s) => s.user?.role)
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
    <AppShell title={t('nav.history')} nav canvas>
      <div className="flex flex-col gap-3">
        {/* Chips: one radio per type (the same pattern as registration's account type), scrolling sideways if they don't fit. */}
        {/* min-w-0: a fieldset is min-content wide by default, so the chips would widen the whole page (and push the fixed nav off a phone screen). */}
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-2 text-sm text-text">{t('history.type')}</legend>
          <div className="-mx-6 flex gap-2 overflow-x-auto px-6">
            {['', ...(role ? TYPES[role] : [])].map((type) => (
              <label key={type} className={CHIP}>
                <input
                  type="radio"
                  name="type"
                  value={type}
                  checked={filters.type === type}
                  onChange={() => set({ type })}
                  className="sr-only"
                />
                {type ? t(`flows.${type}.title`) : t('history.all')}
              </label>
            ))}
          </div>
        </fieldset>
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
          <ul className="flex flex-col divide-y divide-border rounded-3xl border border-border bg-surface px-4">
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
