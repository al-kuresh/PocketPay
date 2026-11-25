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
        // design-ok: balance card. via-primary keeps the white amount on primary (3.6:1, large text); the light end is only the corner.
        className="flex flex-col items-start gap-4 rounded-2xl bg-linear-to-br from-primary via-primary to-primary-light p-6 text-left text-white"
      >
        {/* Small text never sits on the gradient (TASTE.md): the label is a primary-dark pill, white at 5.2:1. */}
        <span className="flex items-center gap-2 rounded-full bg-primary-dark px-3 py-1 text-sm font-semibold">
          {label}
          {shown ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
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
