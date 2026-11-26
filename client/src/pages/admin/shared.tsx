import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'
import { ArrowLeft, Inbox } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { Page } from '../../api/admin'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { errorMessage } from '../../i18n/errors'

interface PagedListProps<T> {
  query: UseInfiniteQueryResult<InfiniteData<Page<T>>>
  /** Already translated. */
  emptyTitle: string
  emptyBody: string
  children(items: T[]): ReactNode
}

/** An admin list's states: loading, error, empty, the rows, and "Load more" while there is a nextCursor. */
export function PagedList<T>({ query, emptyTitle, emptyBody, children }: PagedListProps<T>) {
  const { t } = useTranslation()
  if (query.isPending) return <div aria-hidden className="h-48 animate-pulse rounded-3xl bg-surface-sunken" />
  if (!query.data)
    return (
      <p role="alert" className="text-sm text-danger">
        {errorMessage(t, query.error)}
      </p>
    )
  const items = query.data.pages.flatMap((page) => page.items)
  if (items.length === 0) return <EmptyState icon={Inbox} title={emptyTitle} message={emptyBody} />
  return (
    <div className="flex flex-col gap-3">
      {children(items)}
      {/* A failed "Load more" keeps the pages already shown. */}
      {query.isFetchNextPageError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, query.error)}
        </p>
      )}
      {query.hasNextPage && (
        <Button variant="secondary" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} className="lg:max-w-xs">
          {t('common.loadMore')}
        </Button>
      )}
    </div>
  )
}

/** Back to the list a detail page came from. */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="-ml-3 flex min-h-11 w-fit items-center gap-2 rounded-xl px-3 text-base text-primary-dark hover:bg-primary-50">
      <ArrowLeft aria-hidden className="size-5" />
      {children}
    </Link>
  )
}

/** One label: value line of a detail card (inside a <dl>). */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="text-base text-text">{children}</dd>
    </div>
  )
}

/** A white card section with a heading; a named region for screen readers (and tests). */
export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 rounded-3xl border border-border bg-surface p-6">
      <h2 id={id} className="font-display text-lg font-semibold text-text">
        {title}
      </h2>
      {children}
    </section>
  )
}
