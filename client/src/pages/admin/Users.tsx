import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { listUsers, type AdminUser } from '../../api/admin'
import type { Role, UserStatus } from '../../api/types'
import { ChipGroup } from '../../components/ui/ChipGroup'
import { DataTable } from '../../components/ui/DataTable'
import { Input } from '../../components/ui/Input'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { formatWhen } from '../../lib/dates'
import { useLanguage } from '../../stores/language'
import { PagedList } from './shared'

const ROLES: Role[] = ['CUSTOMER', 'AGENT', 'MERCHANT', 'ADMIN']
const STATUSES: UserStatus[] = ['PENDING_KYC', 'ACTIVE', 'FROZEN', 'REJECTED']

/** Search (a phone prefix, part of a name, or a full NID), role and status filters, newest first. */
export function Users() {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [role, setRole] = useState<Role | ''>('')
  const [status, setStatus] = useState<UserStatus | ''>('')
  // One request 300 ms after the last keystroke, not one per key.
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 300)
    return () => clearTimeout(timer)
  }, [text])

  const list = useInfiniteQuery({
    queryKey: ['admin', 'users', 'list', { q, role, status }],
    queryFn: ({ pageParam }) => listUsers({ q: q || undefined, role: role || undefined, status: status || undefined, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="lg:max-w-md">
          <Input label={t('admin.users.search')} hint={t('admin.users.searchHint')} type="search" value={text} maxLength={60} onChange={(e) => setText(e.target.value)} />
        </div>
        <ChipGroup
          legend={t('admin.fields.role')}
          name="role"
          value={role}
          options={[{ value: '' as const, label: t('common.all') }, ...ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))]}
          onChange={setRole}
        />
        <ChipGroup
          legend={t('admin.fields.status')}
          name="status"
          value={status}
          options={[{ value: '' as const, label: t('common.all') }, ...STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))]}
          onChange={setStatus}
        />
      </div>
      <PagedList query={list} emptyTitle={t('admin.users.empty')} emptyBody={t('admin.users.emptyBody')}>
        {(items: AdminUser[]) => (
          <DataTable
            caption={t('admin.nav.users')}
            rows={items}
            rowKey={(u) => u.id}
            columns={[
              {
                header: t('admin.fields.name'),
                cell: (u) => (
                  <Link
                    to={`/admin/users/${u.id}`}
                    aria-label={t('admin.users.open', { name: u.name })}
                    className="inline-flex min-h-11 items-center font-semibold text-primary-dark hover:underline"
                  >
                    {u.name}
                  </Link>
                ),
              },
              { header: t('admin.fields.phone'), cell: (u) => <span className="tabular-nums">{u.phone}</span> },
              { header: t('admin.fields.nid'), cell: (u) => <span className="tabular-nums">{u.nidMasked}</span> },
              { header: t('admin.fields.role'), cell: (u) => t(`roles.${u.role}`) },
              { header: t('admin.fields.status'), cell: (u) => <StatusBadge status={u.status} label={t(`status.${u.status}`)} /> },
              { header: t('admin.fields.kyc'), cell: (u) => t(`kycStatus.${u.kycStatus ?? 'NONE'}`) },
              { header: t('admin.fields.joined'), cell: (u) => formatWhen(u.createdAt, lang) },
            ]}
          />
        )}
      </PagedList>
    </>
  )
}
