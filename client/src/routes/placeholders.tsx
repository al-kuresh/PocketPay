import { useTranslation } from 'react-i18next'
import { AppShell } from '../components/layout/AppShell'
import { StatusBanner } from '../components/ui/StatusBanner'
import { ComingSoon } from '../pages/admin/ComingSoon'
import { Home as CustomerHome } from '../pages/customer/Home'
import { useSession } from '../stores/session'

// shortcut: placeholder pages until Tasks 7-8 build the real screens.
export function Page({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation()
  return (
    <AppShell title={t(titleKey)}>
      <span />
    </AppShell>
  )
}

/** `/` is every role's home. A PENDING_KYC or REJECTED user sees their status banner; an admin sees the Phase 7 page. */
export function Home() {
  const { t } = useTranslation()
  const user = useSession((s) => s.user)
  if (!user) return null
  if (user.role === 'ADMIN') return <ComingSoon />
  if (user.role === 'CUSTOMER') return <CustomerHome />
  return (
    <AppShell title={t(`placeholder.home.${user.role}`)}>
      {user.status === 'PENDING_KYC' && <StatusBanner kind="PENDING_KYC" />}
      {user.status === 'REJECTED' && <StatusBanner kind="REJECTED" />}
    </AppShell>
  )
}
