import { useQuery } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { me } from '../../api/auth'
import { Skeleton } from '../../components/ui/Skeleton'
import { Stitch } from '../../components/ui/Stitch'
import { errorMessage } from '../../i18n/errors'
import { formatTaka } from '../../lib/money'
import { useLanguage } from '../../stores/language'
import { usePocketTilt } from './usePocketTilt'

/** The stitched pocket: the wallet balance from `me`, hidden as `৳ ••••` until tapped. Lives in the Home hero. `label` is already translated. */
export function BalanceCard({ label }: { label: string }) {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const wallet = useQuery({ queryKey: ['me'], queryFn: me })
  const [shown, setShown] = useState(false)
  const pocket = usePocketTilt<HTMLButtonElement>()
  const balance = wallet.data?.wallet?.balance

  return (
    <div className="flex flex-col gap-2">
      <button
        ref={pocket}
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? undefined : t('home.showBalance')}
        // On the primary-dark hero: white text there is 5.2:1, small text included.
        className="relative flex min-h-11 w-full flex-col items-start gap-3 rounded-2xl p-6 text-left text-white transition-transform duration-150 ease-out-quint"
      >
        <Stitch shape="rect" className="absolute inset-0 size-full stroke-thread" />
        <span className="flex items-center gap-2 text-sm">
          {shown ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          {shown ? label : t('home.showBalance')}
        </span>
        {!shown ? (
          <span className="font-amount text-4xl font-semibold">৳ ••••</span>
        ) : balance !== undefined ? (
          <span className="font-amount text-4xl font-semibold">{formatTaka(balance, { lang })}</span>
        ) : (
          <Skeleton className="h-10 w-40" />
        )}
      </button>
      {wallet.isError && (
        <p role="alert" className="text-sm text-white">
          {errorMessage(t, wallet.error)}
        </p>
      )}
    </div>
  )
}
