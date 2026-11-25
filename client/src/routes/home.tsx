import { ComingSoon } from '../pages/admin/ComingSoon'
import { AgentHome } from '../pages/agent/AgentHome'
import { Home as CustomerHome } from '../pages/customer/Home'
import { MerchantHome } from '../pages/merchant/MerchantHome'
import { useSession } from '../stores/session'

/** `/` is every role's home. Each home shows the KYC banner itself; an admin sees the Phase 7 page. */
export function Home() {
  const role = useSession((s) => s.user?.role)
  if (role === 'ADMIN') return <ComingSoon />
  if (role === 'AGENT') return <AgentHome />
  if (role === 'MERCHANT') return <MerchantHome />
  return role === 'CUSTOMER' ? <CustomerHome /> : null
}
