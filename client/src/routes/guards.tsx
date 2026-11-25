import { Navigate, Outlet } from 'react-router'
import { MobileShell } from '../components/layout/MobileShell'
import type { Role } from '../api/types'
import { useSession } from '../stores/session'

/** Signed in, or off to /login. While restoreSession() runs, a skeleton (no flash of the login page). */
export function RequireAuth() {
  const status = useSession((s) => s.status)
  if (status === 'loading') {
    return (
      <MobileShell>
        <div aria-busy="true" className="m-6 h-32 animate-pulse rounded-2xl bg-surface-sunken" />
      </MobileShell>
    )
  }
  return status === 'authenticated' ? <Outlet /> : <Navigate to="/login" replace />
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
