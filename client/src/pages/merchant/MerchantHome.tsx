import { useTranslation } from 'react-i18next'
import { AppShell } from '../../components/layout/AppShell'
import { Card } from '../../components/ui/Card'
import { LanguageToggle } from '../../components/ui/LanguageToggle'
import { StatusBanner } from '../../components/ui/StatusBanner'
import { ActionGrid } from '../../features/wallet/ActionGrid'
import { BalanceCard } from '../../features/wallet/BalanceCard'
import { RecentTransactions } from '../../features/wallet/RecentTransactions'
import { useSession } from '../../stores/session'

/** The merchant's home: balance, the number customers pay to (QR is v2), History and the latest payments. No money action: merchants only receive. */
export function MerchantHome() {
  const { t } = useTranslation()
  const user = useSession((s) => s.user)
  return (
    <AppShell
      title={user?.shopName ?? t('nav.home')}
      nav
      headerEnd={<LanguageToggle />}
      hero={<BalanceCard label={t('home.balance')} />}
    >
      {user?.status === 'PENDING_KYC' && <StatusBanner kind="PENDING_KYC" />}
      {user?.status === 'REJECTED' && <StatusBanner kind="REJECTED" />}
      <Card className="flex flex-col gap-1">
        <p className="text-sm text-text-muted">{t('merchant.yourNumber')}</p>
        <p className="text-lg font-semibold tabular-nums text-text">{user?.phone}</p>
        <p className="text-sm text-text-muted">{t('merchant.yourNumberHint')}</p>
      </Card>
      <ActionGrid actions={[]} />
      <RecentTransactions />
    </AppShell>
  )
}
