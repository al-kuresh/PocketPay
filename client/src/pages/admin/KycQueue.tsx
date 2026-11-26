import { useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { listKyc, type KycListItem } from '../../api/admin'
import type { KycStatus } from '../../api/types'
import { ChipGroup } from '../../components/ui/ChipGroup'
import { DataTable } from '../../components/ui/DataTable'
import { formatWhen } from '../../lib/dates'
import { useLanguage } from '../../stores/language'
import { PagedList } from './shared'

const STATUSES: KycStatus[] = ['PENDING', 'APPROVED', 'REJECTED']

/** Submissions by status (PENDING oldest first, the others newest first: the server's order), a page at a time. */
export function KycQueue() {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const [status, setStatus] = useState<KycStatus>('PENDING')
  const list = useInfiniteQuery({
    queryKey: ['admin', 'kyc', 'list', status],
    queryFn: ({ pageParam }) => listKyc({ status, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })

  return (
    <>
      <ChipGroup
        legend={t('admin.kyc.statusLabel')}
        name="kyc-status"
        value={status}
        options={STATUSES.map((s) => ({ value: s, label: t(`kycStatus.${s}`) }))}
        onChange={setStatus}
      />
      <PagedList query={list} emptyTitle={t('admin.kyc.empty')} emptyBody={t('admin.kyc.emptyBody')}>
        {(items: KycListItem[]) => (
          <DataTable
            caption={t('admin.nav.kyc')}
            rows={items}
            rowKey={(r) => r.id}
            columns={[
              {
                header: t('admin.fields.name'),
                cell: (r) => (
                  <Link to={`/admin/kyc/${r.id}`} aria-label={t('admin.kyc.open', { name: r.user.name })} className="inline-flex min-h-11 items-center font-semibold text-primary-dark hover:underline">
                    {r.user.name}
                  </Link>
                ),
              },
              { header: t('admin.fields.role'), cell: (r) => t(`roles.${r.user.role}`) },
              { header: t('admin.fields.phone'), cell: (r) => <span className="tabular-nums">{r.user.phone}</span> },
              { header: t('admin.fields.nid'), cell: (r) => <span className="tabular-nums">{r.user.nidMasked}</span> },
              { header: t('admin.fields.submitted'), cell: (r) => formatWhen(r.submittedAt, lang) },
            ]}
          />
        )}
      </PagedList>
    </>
  )
}
