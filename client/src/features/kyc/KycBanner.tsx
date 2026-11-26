import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { myKyc } from '../../api/kyc'
import { StatusBanner } from '../../components/ui/StatusBanner'
import { useSession } from '../../stores/session'

/** Home's KYC banner: "under review" while PENDING_KYC; for REJECTED the admin's reason and "Resubmit documents". Nothing otherwise. */
export function KycBanner() {
  const { t } = useTranslation()
  const status = useSession((s) => s.user?.status)
  const kyc = useQuery({ queryKey: ['kyc'], queryFn: myKyc, enabled: status === 'REJECTED' })
  if (status === 'PENDING_KYC') return <StatusBanner kind="PENDING_KYC" />
  if (status !== 'REJECTED') return null
  const reason = kyc.data?.status === 'REJECTED' ? kyc.data.reason : null
  return (
    <StatusBanner kind="REJECTED">
      {reason && (
        <p className="text-sm text-text">
          <span className="font-semibold">{t('kyc.rejected.reason')}</span> <span>{reason}</span>
        </p>
      )}
      <Link
        to="/kyc/resubmit"
        className="mt-2 inline-flex min-h-11 items-center self-start rounded-xl border border-primary-dark bg-surface px-4 text-sm font-semibold text-primary-dark transition duration-150 ease-out-quint hover:bg-primary-50 active:scale-95"
      >
        {t('kyc.resubmit.button')}
      </Link>
    </StatusBanner>
  )
}
