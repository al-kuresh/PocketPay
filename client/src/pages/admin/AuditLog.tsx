import { useInfiniteQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { listAudit, type AuditItem } from '../../api/admin'
import { DataTable } from '../../components/ui/DataTable'
import { Input } from '../../components/ui/Input'
import { dhakaToday, formatDateTime } from '../../lib/dates'
import { useLanguage } from '../../stores/language'
import { AUDIT_ACTIONS, auditLabel } from './audit'
import { PagedList } from './shared'

/** The metadata object as "key: value" lines (ids, the action's reason). Anything else as JSON. */
function Metadata({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return (
    <div className="flex flex-col gap-1">
      {Object.entries(value).map(([k, v]) => (
        <p key={k}>
          <span className="text-text-muted">{k}</span>: <span>{typeof v === 'string' ? v : JSON.stringify(v)}</span>
        </p>
      ))}
    </div>
  )
}

/** Who did what to whom, newest first; filters: the action and a range of Dhaka days. */
export function AuditLog() {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const actionId = useId()
  const [filters, setFilters] = useState({ action: '', from: '', to: '' })
  const today = dhakaToday()
  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch }))
  const list = useInfiniteQuery({
    queryKey: ['admin', 'audit', filters],
    queryFn: ({ pageParam }) =>
      listAudit({ action: filters.action || undefined, from: filters.from || undefined, to: filters.to || undefined, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-1">
          <label htmlFor={actionId} className="text-sm text-text">
            {t('admin.audit.action')}
          </label>
          <select
            id={actionId}
            value={filters.action}
            onChange={(e) => set({ action: e.target.value })}
            className="h-12 rounded-xl border border-border-strong bg-surface px-4 text-base text-text"
          >
            <option value="">{t('admin.audit.allActions')}</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {auditLabel(t, a)}
              </option>
            ))}
          </select>
        </div>
        {/* The inputs' own YYYY-MM-DD, which the API reads as Dhaka days (as in History). */}
        <Input label={t('history.from')} type="date" value={filters.from} max={filters.to || today} onChange={(e) => set({ from: e.target.value })} />
        <Input label={t('history.to')} type="date" value={filters.to} min={filters.from || undefined} max={today} onChange={(e) => set({ to: e.target.value })} />
      </div>
      <PagedList query={list} emptyTitle={t('admin.audit.empty')} emptyBody={t('admin.audit.emptyBody')}>
        {(items: AuditItem[]) => (
          <DataTable
            caption={t('admin.nav.audit')}
            rows={items}
            rowKey={(a) => a.id}
            columns={[
              { header: t('admin.audit.action'), cell: (a) => <span className="font-semibold">{auditLabel(t, a.action)}</span> },
              { header: t('admin.audit.time'), cell: (a) => <span className="whitespace-nowrap">{formatDateTime(a.createdAt, lang)}</span> },
              { header: t('admin.audit.actor'), cell: (a) => a.actor?.name ?? t('common.system') },
              {
                header: t('admin.audit.target'),
                wrap: true,
                cell: (a) =>
                  a.targetType === 'user' && a.targetId ? (
                    <Link to={`/admin/users/${a.targetId}`} className="inline-flex min-h-11 items-center text-primary-dark underline tabular-nums">
                      {a.targetId.slice(0, 8)}
                    </Link>
                  ) : (
                    (a.targetId?.slice(0, 8) ?? '')
                  ),
              },
              { header: t('admin.audit.details'), wrap: true, cell: (a) => <Metadata value={a.metadata} /> },
              { header: t('admin.audit.ip'), cell: (a) => <span className="tabular-nums">{a.ip ?? ''}</span> },
            ]}
          />
        )}
      </PagedList>
    </>
  )
}
