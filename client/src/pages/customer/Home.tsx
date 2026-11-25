import { Banknote, Send, Store } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppShell } from '../../components/layout/AppShell'
import { LanguageToggle } from '../../components/ui/LanguageToggle'
import { StatusBanner } from '../../components/ui/StatusBanner'
import { ActionGrid } from '../../features/wallet/ActionGrid'
import { BalanceCard } from '../../features/wallet/BalanceCard'
import { RecentTransactions } from '../../features/wallet/RecentTransactions'
import { useSession } from '../../stores/session'

const ACTIONS = [
  { type: 'SEND_MONEY', Icon: Send },
  { type: 'CASH_OUT', Icon: Banknote },
  { type: 'PAYMENT', Icon: Store },
] as const

/** The customer's home: balance (hidden until tapped), the action grid, the 5 latest transactions. */
export function Home() {
  const { t } = useTranslation()
  const status = useSession((s) => s.user?.status)
  return (
    <AppShell title={t('nav.home')} nav headerEnd={<LanguageToggle />}>
      {status === 'PENDING_KYC' && <StatusBanner kind="PENDING_KYC" />}
      {status === 'REJECTED' && <StatusBanner kind="REJECTED" />}
      <BalanceCard label={t('home.balance')} />
      <ActionGrid actions={ACTIONS} />
      <RecentTransactions />
    </AppShell>
  )
}
