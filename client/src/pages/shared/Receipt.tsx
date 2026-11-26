import { useQuery } from '@tanstack/react-query'
import { SearchX } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError } from '../../api/client'
import { receipt } from '../../api/transactions'
import type { Receipt } from '../../api/types'
import { AppShell } from '../../components/layout/AppShell'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import { Counterparty, ReceiptCard, ShareButton } from '../../features/transfer/ReceiptCard'
import { errorMessage } from '../../i18n/errors'
import { formatTaka } from '../../lib/money'
import { useLanguage } from '../../stores/language'

/** `/transactions/:trxId`: one receipt. Someone else's (the API answers 404, like a missing one) or a malformed id → not found. */
export function ReceiptPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { trxId = '' } = useParams()
  // A 4xx is never retried (createQueryClient), so a 404 shows at once.
  const query = useQuery({ queryKey: ['receipt', trxId], queryFn: () => receipt(trxId) })
  const notFound = query.error instanceof ApiError && (query.error.status === 404 || query.error.code === 'VALIDATION_ERROR')

  return (
    <AppShell title={t('receipt.title')} onBack={() => void navigate('/history')} canvas>
      {query.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-48" />
        </div>
      ) : notFound ? (
        <EmptyState
          icon={SearchX}
          title={t('receipt.notFound')}
          message={t('receipt.notFoundBody')}
          action={
            <Link to="/history" className="flex min-h-11 items-center text-sm text-primary-dark">
              {t('receipt.backToHistory')}
            </Link>
          }
        />
      ) : query.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, query.error)}
        </p>
      ) : (
        <ReceiptDetails receipt={query.data} />
      )}
    </AppShell>
  )
}

/** What it was (the flow, the amount, with whom), then the same receipt card as the Sent screen, and Share. */
function ReceiptDetails({ receipt }: { receipt: Receipt }) {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col items-center gap-2 pt-6 text-center">
        <h2 id={headingId} className="text-base text-text-muted">
          {t(`flows.${receipt.type}.title`)}
        </h2>
        <p className="font-amount text-4xl font-semibold text-text">{formatTaka(receipt.amount, { lang })}</p>
        <Counterparty receipt={receipt} />
      </div>
      <ReceiptCard receipt={receipt} />
      <div className="mt-auto">
        <ShareButton trxId={receipt.trxId} />
      </div>
    </section>
  )
}
