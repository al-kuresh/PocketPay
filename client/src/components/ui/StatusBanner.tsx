import { CircleAlert, Clock, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Kind = 'PENDING_KYC' | 'REJECTED' | 'DEMO'

const STATUS = {
  PENDING_KYC: { Icon: Clock, border: 'border-warning', text: 'text-warning-dark', key: 'kyc.pending' },
  REJECTED: { Icon: CircleAlert, border: 'border-danger', text: 'text-danger', key: 'kyc.rejected' },
} as const

/** The KYC state of a non-ACTIVE account, or the demo's "don't upload a real NID" warning. */
export function StatusBanner({ kind }: { kind: Kind }) {
  const { t } = useTranslation()
  if (kind === 'DEMO') {
    return (
      <div className="flex gap-3 rounded-xl bg-primary-50 p-4">
        <ShieldAlert aria-hidden className="size-5 shrink-0 text-primary" />
        <p className="text-sm text-text">{t('kyc.demo')}</p>
      </div>
    )
  }
  const { Icon, border, text, key } = STATUS[kind]
  return (
    <div className={`flex gap-3 rounded-xl border bg-surface p-4 ${border}`}>
      <Icon aria-hidden className={`size-5 shrink-0 ${text}`} />
      <div className="flex flex-col gap-1">
        <p className={`text-sm font-semibold ${text}`}>{t(`${key}.title`)}</p>
        <p className="text-sm text-text">{t(`${key}.body`)}</p>
      </div>
    </div>
  )
}
