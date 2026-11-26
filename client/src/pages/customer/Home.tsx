import { Send, ShoppingBag, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppShell } from '../../components/layout/AppShell'
import { KycBanner } from '../../features/kyc/KycBanner'
import { ActionGrid } from '../../features/wallet/ActionGrid'
import { HomeHero } from '../../features/wallet/HomeHero'
import { RecentTransactions } from '../../features/wallet/RecentTransactions'

const ACTIONS = [
  { type: 'SEND_MONEY', Icon: Send },
  { type: 'CASH_OUT', Icon: Wallet },
  { type: 'PAYMENT', Icon: ShoppingBag },
] as const

/** The customer's home: the greeting and the stitched pocket (balance hidden until tapped), the action panel, the 5 latest transactions. */
export function Home() {
  const { t } = useTranslation()
  return (
    <AppShell nav hero={<HomeHero label={t('home.balance')} />}>
      <ActionGrid actions={ACTIONS} />
      <KycBanner />
      <RecentTransactions />
    </AppShell>
  )
}
