import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { changeUserStatus, getUser, unlockUser } from '../../api/admin'
import { ApiError } from '../../api/client'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useToast } from '../../components/ui/toast-context'
import { errorMessage } from '../../i18n/errors'
import { formatDateTime } from '../../lib/dates'
import { toLangDigits } from '../../lib/digits'
import { formatTaka } from '../../lib/money'
import { useLanguage } from '../../stores/language'
import { auditLabel } from './audit'
import { BackLink, Field, Section } from './shared'

type Action = 'FREEZE' | 'UNFREEZE'

/** One user: who, the balance, KYC, the PIN lock, the last 10 audit rows; Freeze / Unfreeze and Clear PIN lock. */
export function UserDetail() {
  const { id = '' } = useParams()
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const toast = useToast()
  const queryClient = useQueryClient()
  const activityId = useId()
  const query = useQuery({ queryKey: ['admin', 'users', 'detail', id], queryFn: () => getUser(id) })
  const [dialog, setDialog] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const status = useMutation({ mutationFn: (body: { action: Action; reason: string }) => changeUserStatus(id, body) })
  const unlock = useMutation({ mutationFn: () => unlockUser(id) })
  // The detail and the lists (their status badges).
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })

  if (query.isPending) return <div aria-hidden className="h-96 animate-pulse rounded-3xl bg-surface-sunken" />
  if (!query.data)
    return (
      <>
        <BackLink to="/admin/users">{t('admin.users.back')}</BackLink>
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, query.error)}
        </p>
      </>
    )

  const user = query.data
  const name = user.name
  const isAdmin = user.role === 'ADMIN' // the server refuses admins anyway (422)
  // As of the fetch (a refetch after Clear PIN lock or a focus updates it); render stays pure.
  const locked = !!user.lockedUntil && Date.parse(user.lockedUntil) > query.dataUpdatedAt
  const action: Action | null = isAdmin ? null : user.status === 'ACTIVE' ? 'FREEZE' : user.status === 'FROZEN' ? 'UNFREEZE' : null

  function close() {
    setDialog(null)
    setReason('')
    refresh()
  }
  function send(body: { action: Action; reason: string }) {
    status.mutate(body, {
      onSuccess: () => {
        toast.show(t(body.action === 'FREEZE' ? 'admin.users.frozen' : 'admin.users.unfrozen', { name }), 'success')
        close()
      },
      onError: (err) => {
        toast.show(errorMessage(t, err))
        // The status changed meanwhile (another admin, a KYC decision): show what is true now.
        if (err instanceof ApiError && err.status === 409) close()
      },
    })
  }
  function clearLock() {
    unlock.mutate(undefined, {
      onSuccess: (r) => toast.show(r.unlocked ? t('admin.users.unlocked', { name }) : t('admin.users.notLocked'), 'success'),
      onError: (err) => toast.show(errorMessage(t, err)),
      onSettled: refresh,
    })
  }

  return (
    <>
      <BackLink to="/admin/users">{t('admin.users.back')}</BackLink>
      <section className="flex flex-col gap-4 rounded-3xl border border-border bg-surface p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-xl font-semibold text-text">{name}</h2>
          <StatusBadge status={user.status} label={t(`status.${user.status}`)} />
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t('admin.fields.phone')}>
            <span className="tabular-nums">{user.phone}</span>
          </Field>
          <Field label={t('admin.fields.nid')}>
            <span className="tabular-nums">{user.nidMasked}</span>
          </Field>
          <Field label={t('admin.fields.role')}>{t(`roles.${user.role}`)}</Field>
          {user.shopName && <Field label={t('admin.fields.shopName')}>{user.shopName}</Field>}
          {user.balance !== null && (
            <Field label={t('admin.fields.balance')}>
              <span className="font-display tabular-nums">{formatTaka(user.balance, { lang })}</span>
            </Field>
          )}
          <Field label={t('admin.fields.kyc')}>
            <span className="flex flex-wrap items-center gap-x-3">
              {t(`kycStatus.${user.latestKyc?.status ?? 'NONE'}`)}
              {user.latestKyc && (
                <Link to={`/admin/kyc/${user.latestKyc.id}`} className="inline-flex min-h-11 items-center text-primary-dark underline">
                  {t('admin.users.openReview')}
                </Link>
              )}
            </span>
          </Field>
          <Field label={t('admin.fields.failedPins')}>
            <span className="tabular-nums">{toLangDigits(String(user.failedPinAttempts), lang)}</span>
          </Field>
          {locked && <Field label={t('admin.fields.lockedUntil')}>{formatDateTime(user.lockedUntil!, lang)}</Field>}
          <Field label={t('admin.fields.joined')}>{formatDateTime(user.createdAt, lang)}</Field>
        </dl>
      </section>

      {(action || (locked && !isAdmin)) && (
        <div className="grid gap-3 sm:grid-cols-2 lg:max-w-xl">
          {action && (
            <Button variant="secondary" onClick={() => setDialog(action)}>
              {t(action === 'FREEZE' ? 'admin.users.freeze' : 'admin.users.unfreeze')}
            </Button>
          )}
          {/* Only while a lock is running: an expired lock clears itself at the next login. */}
          {locked && !isAdmin && (
            <Button variant="secondary" loading={unlock.isPending} onClick={clearLock}>
              {t('admin.users.unlock')}
            </Button>
          )}
        </div>
      )}

      <Section id={activityId} title={t('admin.users.activity')}>
        {user.recentAudit.length === 0 ? (
          <p className="text-sm text-text-muted">{t('admin.users.noActivity')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {user.recentAudit.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3 text-sm first:pt-0 last:pb-0">
                <span className="flex flex-wrap gap-x-2">
                  <span className="text-text">{auditLabel(t, a.action)}</span>
                  <span className="text-text-muted">{a.actor?.name ?? t('common.system')}</span>
                </span>
                <span className="text-text-muted">{formatDateTime(a.createdAt, lang)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {dialog && (
        <ConfirmDialog
          title={t(dialog === 'FREEZE' ? 'admin.users.freezeTitle' : 'admin.users.unfreezeTitle', { name })}
          message={t(dialog === 'FREEZE' ? 'admin.users.freezeBody' : 'admin.users.unfreezeBody')}
          confirmLabel={t(dialog === 'FREEZE' ? 'admin.users.freeze' : 'admin.users.unfreeze')}
          busy={status.isPending}
          reason={reason}
          onReasonChange={setReason}
          onConfirm={() => send({ action: dialog, reason: reason.trim() })}
          onCancel={() => setDialog(null)}
        />
      )}
    </>
  )
}
