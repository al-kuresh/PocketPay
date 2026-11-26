import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Initials } from '../../components/ui/Initials'
import { LanguageToggle } from '../../components/ui/LanguageToggle'
import { greetingKey } from '../../lib/dates'
import { useSession } from '../../stores/session'
import { BalanceCard } from './BalanceCard'

/** The top of every Home: the greeting (initials, the name or shop name, the language), then the stitched pocket. `label` names the balance, translated. */
export function HomeHero({ label }: { label: string }) {
  const { t } = useTranslation()
  const user = useSession((s) => s.user)
  const name = user?.shopName ?? user?.name ?? ''
  const [greeting] = useState(() => greetingKey(new Date())) // fixed when Home opens: no re-render ticks the clock
  return (
    // pb-16: room for the action panel, which overlaps the hero's lower edge.
    <div className="flex flex-col gap-6 pt-6 pb-16">
      {/* No app bar on Home: the page heading is for screen readers only. */}
      <h1 className="sr-only">{t('nav.home')}</h1>
      <div className="flex items-center gap-3">
        <Initials name={name} />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="text-sm">{t(`home.greeting.${greeting}`)}</p>
          <p className="truncate font-display text-lg font-semibold">{name}</p>
        </div>
        <LanguageToggle />
      </div>
      <BalanceCard label={label} />
    </div>
  )
}
