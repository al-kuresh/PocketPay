import { useQuery } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { me } from '../../api/auth'
import { Skeleton } from '../../components/ui/Skeleton'
import { errorMessage } from '../../i18n/errors'
import { formatTaka } from '../../lib/money'
import { useLanguage } from '../../stores/language'

/** The wallet balance from `me`, hidden as `৳ ••••` until tapped. `label` is already translated. */
export function BalanceCard({ label }: { label: string }) {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const wallet = useQuery({ queryKey: ['me'], queryFn: me })
  const [shown, setShown] = useState(false)
  const balance = wallet.data?.wallet?.balance

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? undefined : t('home.showBalance')}
        // design-ok: balance card
        className="flex flex-col gap-2 rounded-2xl bg-linear-to-br from-primary to-primary-light p-6 text-left text-white"
      >
        <span className="flex items-center justify-between text-lg font-semibold">
          {label}
          {shown ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
        </span>
        {!shown ? (
          <span className="text-4xl font-semibold tabular-nums">৳ ••••</span>
        ) : balance !== undefined ? (
          <span className="text-4xl font-semibold tabular-nums">{formatTaka(balance, { lang })}</span>
        ) : (
          <Skeleton className="h-10 w-40" />
        )}
      </button>
      {wallet.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, wallet.error)}
        </p>
      )}
    </div>
  )
}
