import { useQuery } from '@tanstack/react-query'
import { SearchX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError } from '../../api/client'
import { receipt } from '../../api/transactions'
import { AppShell } from '../../components/layout/AppShell'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import { ReceiptView } from '../../features/transfer/TransferFlow'
import { errorMessage } from '../../i18n/errors'

/** `/transactions/:trxId`: one receipt. Someone else's (the API answers 404, like a missing one) or a malformed id → not found. */
export function ReceiptPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { trxId = '' } = useParams()
  // A 4xx is never retried (createQueryClient), so a 404 shows at once.
  const query = useQuery({ queryKey: ['receipt', trxId], queryFn: () => receipt(trxId) })
  const notFound = query.error instanceof ApiError && (query.error.status === 404 || query.error.code === 'VALIDATION_ERROR')

  return (
    <AppShell title={t('receipt.title')} onBack={() => void navigate('/history')}>
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
        <ReceiptView receipt={query.data} />
      )}
    </AppShell>
  )
}
