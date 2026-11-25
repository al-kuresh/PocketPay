import { Wrench } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { logout } from '../../api/auth'
import { AppShell } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { LanguageToggle } from '../../components/ui/LanguageToggle'

/** What an admin sees until the admin panel (Phase 7). */
export function ComingSoon() {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)

  async function logOut() {
    setBusy(true)
    try {
      await logout() // drops the session from memory even if the call fails; RequireAuth then goes to /login
    } catch {
      // nothing to show: the user is logged out on this device either way
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell title={t('admin.title')} headerEnd={<LanguageToggle />}>
      <EmptyState icon={Wrench} title={t('admin.comingSoon')} message={t('admin.comingSoonBody')} />
      <Button variant="secondary" loading={busy} onClick={logOut} className="mt-auto">
        {t('common.logout')}
      </Button>
    </AppShell>
  )
}
