import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImageOff, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { getKyc, reviewKyc, type KycDecision, type KycDetail } from '../../api/admin'
import { ApiError } from '../../api/client'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Dialog } from '../../components/ui/Dialog'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useToast } from '../../components/ui/toast-context'
import { errorMessage } from '../../i18n/errors'
import { dhakaToday, formatDate, formatDateTime, yearsOld } from '../../lib/dates'
import { useLanguage } from '../../stores/language'
import { BackLink, Field, Section } from './shared'

const IMAGES = [
  ['nidFront', 'admin.kyc.nidFront'],
  ['nidBack', 'admin.kyc.nidBack'],
  ['selfie', 'admin.kyc.selfie'],
] as const

/**
 * One submission: the full NID next to the three images (signed links, 300 s), earlier submissions, and Approve /
 * Reject on the user's latest PENDING one. The detail lives only in memory while the page is open (gcTime 0).
 */
export function KycReview() {
  const { id = '' } = useParams()
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  // Fresh on every visit (staleTime 0) and dropped as soon as the page closes (gcTime 0): no full NID or signed link
  // stays in the cache. Each fetch is one KYC_VIEWED audit row on the server.
  const query = useQuery({ queryKey: ['admin', 'kyc', 'detail', id], queryFn: () => getKyc(id), gcTime: 0, staleTime: 0 })
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null)
  const [reason, setReason] = useState('')
  const decide = useMutation({ mutationFn: (body: KycDecision) => reviewKyc(id, body) })

  // A signed link that fails (most likely expired: 300 s) → refetch the detail once for new links. Only once per
  // visit, so a broken image can't loop. `failed` holds the srcs that failed; a new link renders a new <img>.
  const [failed, setFailed] = useState<string[]>([])
  const retried = useRef(false)
  function onImageError(src: string) {
    setFailed((f) => [...f, src])
    if (!retried.current) {
      retried.current = true
      void query.refetch()
    }
  }

  if (query.isPending) return <div aria-hidden className="h-96 animate-pulse rounded-3xl bg-surface-sunken" />
  if (!query.data)
    return (
      <>
        <BackLink to="/admin/kyc">{t('admin.kyc.back')}</BackLink>
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, query.error)}
        </p>
      </>
    )

  const kyc = query.data
  const name = kyc.user.name
  const canDecide = kyc.status === 'PENDING' && kyc.isLatest

  function close() {
    setDialog(null)
    setReason('')
    // The detail (this page), the queue and the sidebar's pending count.
    void queryClient.invalidateQueries({ queryKey: ['admin', 'kyc'] })
  }
  function send(body: KycDecision) {
    decide.mutate(body, {
      onSuccess: () => {
        toast.show(t(body.decision === 'APPROVE' ? 'admin.kyc.approved' : 'admin.kyc.rejected', { name }), 'success')
        close()
      },
      onError: (err) => {
        toast.show(errorMessage(t, err))
        // Someone else decided, the user resubmitted, or their status changed: show what is true now. Any other
        // failure keeps the dialog (and the typed reason) open for another try.
        if (err instanceof ApiError && err.status === 409) close()
      },
    })
  }

  return (
    <>
      <BackLink to="/admin/kyc">{t('admin.kyc.back')}</BackLink>
      <Details kyc={kyc} />

      <ul aria-label={t('admin.kyc.documents')} className="grid gap-4 lg:grid-cols-3">
        {IMAGES.map(([key, label]) => (
          <li key={key}>
            <KycImage src={kyc.images[key]} label={t(label)} broken={failed.includes(kyc.images[key])} onError={onImageError} />
          </li>
        ))}
      </ul>

      {canDecide ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:max-w-xl">
          <Button variant="secondary" onClick={() => setDialog('reject')}>
            {t('admin.kyc.reject')}
          </Button>
          <Button onClick={() => setDialog('approve')}>{t('admin.kyc.approve')}</Button>
        </div>
      ) : (
        <Outcome kyc={kyc} />
      )}

      {kyc.history.length > 0 && <Earlier history={kyc.history} />}

      {dialog === 'approve' && (
        <ConfirmDialog
          title={t('admin.kyc.approveTitle', { name })}
          message={t('admin.kyc.approveBody')}
          confirmLabel={t('admin.kyc.approve')}
          busy={decide.isPending}
          onConfirm={() => send({ decision: 'APPROVE' })}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'reject' && (
        <ConfirmDialog
          title={t('admin.kyc.rejectTitle', { name })}
          message={t('admin.kyc.rejectBody')}
          confirmLabel={t('admin.kyc.reject')}
          busy={decide.isPending}
          reason={reason}
          onReasonChange={setReason}
          quickReasons={(['blurry', 'mismatch', 'selfie'] as const).map((k) => ({ label: t(`admin.kyc.quick.${k}`), text: t(`admin.kyc.quick.${k}Text`) }))}
          onConfirm={() => send({ decision: 'REJECT', reason: reason.trim() })}
          onCancel={() => setDialog(null)}
        />
      )}
    </>
  )
}

/** Who, with the full NID large enough to compare with the photo. */
function Details({ kyc }: { kyc: KycDetail }) {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const titleId = useId()
  const { user } = kyc
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4 rounded-3xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={titleId} className="font-display text-xl font-semibold text-text">
          {user.name}
        </h2>
        <StatusBadge status={kyc.status} label={t(`kycStatus.${kyc.status}`)} />
      </div>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('admin.fields.nidFull')}>
          <span className="font-amount text-xl">{user.nidNumber}</span>
        </Field>
        <Field label={t('admin.fields.dob')}>
          {formatDate(user.dateOfBirth, lang)} · {t('admin.age', { count: yearsOld(user.dateOfBirth, dhakaToday()) })}
        </Field>
        <Field label={t('admin.fields.phone')}>
          <span className="tabular-nums">{user.phone}</span>
        </Field>
        <Field label={t('admin.fields.role')}>{t(`roles.${user.role}`)}</Field>
        {user.shopName && <Field label={t('admin.fields.shopName')}>{user.shopName}</Field>}
        <Field label={t('admin.fields.status')}>{t(`status.${user.status}`)}</Field>
        <Field label={t('admin.fields.submitted')}>{formatDateTime(kyc.submittedAt, lang)}</Field>
      </dl>
    </section>
  )
}

/** A document photo; a tap opens it full size. A failed load shows a message instead (the page retries once). */
function KycImage({ src, label, broken, onError }: { src: string; label: string; broken: boolean; onError(src: string): void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <figure className="flex flex-col gap-2">
      {broken ? (
        <div className="flex aspect-3/2 flex-col items-center justify-center gap-2 rounded-3xl border border-border bg-surface-sunken p-4 text-center">
          <ImageOff aria-hidden className="size-6 text-text-muted" />
          <p className="text-sm text-text">{t('admin.kyc.imageFailed')}</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('admin.kyc.openImage', { label })}
          className="overflow-hidden rounded-3xl border border-border bg-surface-sunken transition duration-150 ease-out-quint hover:border-border-strong"
        >
          {/* key: a new link is a new <img>, so a refetch really retries */}
          <img key={src} src={src} alt={label} onError={() => onError(src)} className="aspect-3/2 w-full object-contain" />
        </button>
      )}
      <figcaption className="text-sm text-text">{label}</figcaption>
      {open && (
        <Dialog title={label} onClose={() => setOpen(false)} className="max-h-full w-full max-w-4xl gap-3 rounded-3xl p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-display text-lg font-semibold text-text">{label}</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('common.close')}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-text hover:bg-surface-sunken"
            >
              <X aria-hidden className="size-6" />
            </button>
          </div>
          <img src={src} alt={label} onError={() => onError(src)} className="min-h-0 w-full flex-1 object-contain" />
        </Dialog>
      )}
    </figure>
  )
}

/** Why there are no buttons: already reviewed (by whom, why), or a newer submission exists. */
function Outcome({ kyc }: { kyc: KycDetail }) {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  if (kyc.status === 'PENDING') return <p className="rounded-3xl bg-primary-50 p-4 text-sm text-text">{t('admin.kyc.notLatestNote')}</p>
  return (
    <div className="flex flex-col gap-1 rounded-3xl bg-primary-50 p-4 text-sm text-text">
      <p className="font-semibold">{t('admin.kyc.reviewedNote')}</p>
      {kyc.reviewedBy && kyc.reviewedAt && (
        <p>
          {t('admin.kyc.reviewedBy', { name: kyc.reviewedBy.name })} · {formatDateTime(kyc.reviewedAt, lang)}
        </p>
      )}
      {kyc.reason && (
        <p>
          {t('kyc.rejected.reason')} {kyc.reason}
        </p>
      )}
    </div>
  )
}

function Earlier({ history }: { history: KycDetail['history'] }) {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const id = useId()
  return (
    <Section id={id} title={t('admin.kyc.earlier')}>
      <ul className="flex flex-col divide-y divide-border">
        {history.map((h) => (
          <li key={h.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={h.status} label={t(`kycStatus.${h.status}`)} />
              <span className="text-sm text-text-muted">{formatDateTime(h.submittedAt, lang)}</span>
            </div>
            {h.reason && (
              <p className="text-sm text-text">
                {t('kyc.rejected.reason')} {h.reason}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}
