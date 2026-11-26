import { useTranslation } from 'react-i18next'
import { AppShell } from '../../components/layout/AppShell'
import { Card } from '../../components/ui/Card'
import { KycBanner } from '../../features/kyc/KycBanner'
import { ActionGrid } from '../../features/wallet/ActionGrid'
import { HomeHero } from '../../features/wallet/HomeHero'
import { RecentTransactions } from '../../features/wallet/RecentTransactions'
import { useSession } from '../../stores/session'

/** The merchant's home: the shop's greeting and balance, History, the number customers pay to (QR is v2), the latest payments. No money action: merchants only receive. */
export function MerchantHome() {
  const { t } = useTranslation()
  const user = useSession((s) => s.user)
  return (
    <AppShell nav hero={<HomeHero label={t('home.balance')} />}>
      <ActionGrid actions={[]} />
      <KycBanner />
      <Card className="flex flex-col gap-1">
        <p className="text-sm text-text-muted">{t('merchant.yourNumber')}</p>
        <p className="font-display text-xl font-semibold tabular-nums text-text">{user?.phone}</p>
        <p className="text-sm text-text-muted">{t('merchant.yourNumberHint')}</p>
      </Card>
      <RecentTransactions />
    </AppShell>
  )
}
