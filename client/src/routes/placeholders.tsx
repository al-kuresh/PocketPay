import { useTranslation } from 'react-i18next'
import { MobileShell } from '../components/layout/MobileShell'
import { useSession } from '../stores/session'

// shortcut: placeholder pages until Tasks 5-8 build the real screens.
export function Page({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation()
  return (
    <MobileShell>
      <main className="p-6">
        <h1 className="text-xl font-semibold text-text">{t(titleKey)}</h1>
      </main>
    </MobileShell>
  )
}

/** `/` is every role's home; it shows the page for the signed-in role. */
export function Home() {
  const role = useSession((s) => s.user?.role)
  return role ? <Page titleKey={`placeholder.home.${role}`} /> : null
}
