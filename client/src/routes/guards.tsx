import { Navigate, Outlet } from 'react-router'
import { MobileShell } from '../components/layout/MobileShell'
import type { Role } from '../api/types'
import { useSession } from '../stores/session'

/** While restoreSession() runs: a skeleton, so neither the login form nor a protected page flashes. */
function SessionSkeleton() {
  return (
    <MobileShell>
      <div aria-busy="true" className="m-6 h-32 animate-pulse rounded-2xl bg-surface-sunken" />
    </MobileShell>
  )
}

/** Signed in, or off to /login. */
export function RequireAuth() {
  const status = useSession((s) => s.status)
  if (status === 'loading') return <SessionSkeleton />
  return status === 'authenticated' ? <Outlet /> : <Navigate to="/login" replace />
}

/** Login and registration: a signed-in user goes to their home (also right after logging in or registering). */
export function RequireAnonymous() {
  const status = useSession((s) => s.status)
  if (status === 'loading') return <SessionSkeleton />
  return status === 'anonymous' ? <Outlet /> : <Navigate to="/" replace />
}

/** A page of another role sends the user to their own home. Must sit inside RequireAuth. */
export function RequireRole({ role }: { role: Role }) {
  const userRole = useSession((s) => s.user?.role)
  return userRole === role ? <Outlet /> : <Navigate to="/" replace />
}

/** Money routes: PENDING_KYC and REJECTED users stay on home (design §5), even by typing the URL. */
export function RequireActive() {
  const status = useSession((s) => s.user?.status)
  return status === 'ACTIVE' ? <Outlet /> : <Navigate to="/" replace />
}
