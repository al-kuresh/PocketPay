import { Send, ShoppingBag, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppShell } from '../../components/layout/AppShell'
import { StatusBanner } from '../../components/ui/StatusBanner'
import { ActionGrid } from '../../features/wallet/ActionGrid'
import { HomeHero } from '../../features/wallet/HomeHero'
import { RecentTransactions } from '../../features/wallet/RecentTransactions'
import { useSession } from '../../stores/session'

const ACTIONS = [
  { type: 'SEND_MONEY', Icon: Send },
  { type: 'CASH_OUT', Icon: Wallet },
  { type: 'PAYMENT', Icon: ShoppingBag },
] as const

/** The customer's home: the greeting and the stitched pocket (balance hidden until tapped), the action panel, the 5 latest transactions. */
export function Home() {
  const { t } = useTranslation()
  const status = useSession((s) => s.user?.status)
  return (
    <AppShell nav hero={<HomeHero label={t('home.balance')} />}>
      <ActionGrid actions={ACTIONS} />
      {status === 'PENDING_KYC' && <StatusBanner kind="PENDING_KYC" />}
      {status === 'REJECTED' && <StatusBanner kind="REJECTED" />}
      <RecentTransactions />
    </AppShell>
  )
}
