import { HandCoins } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppShell } from '../../components/layout/AppShell'
import { KycBanner } from '../../features/kyc/KycBanner'
import { ActionGrid } from '../../features/wallet/ActionGrid'
import { HomeHero } from '../../features/wallet/HomeHero'
import { RecentTransactions } from '../../features/wallet/RecentTransactions'

const ACTIONS = [{ type: 'CASH_IN', Icon: HandCoins }] as const

/** The agent's home: the e-money balance, Cash In and History, the latest transactions (a Cash Out received shows the commission-included amount, as the API gives it). */
export function AgentHome() {
  const { t } = useTranslation()
  return (
    <AppShell nav hero={<HomeHero label={t('home.eMoney')} />}>
      <ActionGrid actions={ACTIONS} />
      <KycBanner />
      <RecentTransactions />
    </AppShell>
  )
}
