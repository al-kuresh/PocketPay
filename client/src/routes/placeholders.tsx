import { MobileShell } from '../components/layout/MobileShell'
import { useSession } from '../stores/session'

// shortcut: placeholder pages until Tasks 5-8 build the real screens (and move these strings into i18n).
export function Page({ title }: { title: string }) {
  return (
    <MobileShell>
      <main className="p-6">
        <h1 className="text-xl font-semibold text-text">{title}</h1>
      </main>
    </MobileShell>
  )
}

const HOME_TITLE = { CUSTOMER: 'Customer home', AGENT: 'Agent home', MERCHANT: 'Merchant home', ADMIN: 'Admin home' }

/** `/` is every role's home; it shows the page for the signed-in role. */
export function Home() {
  const role = useSession((s) => s.user?.role)
  return role ? <Page title={HOME_TITLE[role]} /> : null
}
