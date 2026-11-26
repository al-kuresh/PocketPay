import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate } from 'react-router'
import { z } from 'zod'
import { resubmitKyc } from '../../api/kyc'
import { AppShell } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { ImagePicker } from '../../components/ui/ImagePicker'
import { StatusBanner } from '../../components/ui/StatusBanner'
import { errorMessage } from '../../i18n/errors'
import { useSession } from '../../stores/session'

const photo = z.instanceof(File, { message: 'validation.photo' })
const schema = z.object({ nidFront: photo, nidBack: photo, selfie: photo })
type Values = z.infer<typeof schema>

// The same 3 pickers and labels as registration's photo step.
const PHOTOS = [
  { name: 'nidFront', label: 'register.photos.nidFront' },
  { name: 'nidBack', label: 'register.photos.nidBack' },
  { name: 'selfie', label: 'register.photos.selfie', capture: 'user' },
] as const

/** A REJECTED user's new NID photos and selfie, as ONE multipart request. Success → home, which now says "under review". */
export function Resubmit() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Checked once on arrival: success changes the status, and the page then leaves on its own terms.
  const [allowed] = useState(() => useSession.getState().user?.status === 'REJECTED')
  const [failure, setFailure] = useState<unknown>(null)
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) })

  if (!allowed) return <Navigate to="/" replace />

  async function submit(v: Values) {
    setFailure(null)
    const form = new FormData()
    form.append('nidFront', v.nidFront)
    form.append('nidBack', v.nidBack)
    form.append('selfie', v.selfie)
    try {
      await resubmitKyc(form)
    } catch (e) {
      setFailure(e)
      return
    }
    // 'all': the home's queries are inactive while this page is open.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['me'], refetchType: 'all' }),
      queryClient.invalidateQueries({ queryKey: ['kyc'], refetchType: 'all' }),
    ])
    void navigate('/', { replace: true })
  }

  return (
    <AppShell title={t('kyc.resubmit.title')} onBack={() => void navigate('/')}>
      <form noValidate onSubmit={(e) => void handleSubmit(submit)(e)} className="flex flex-1 flex-col gap-6">
        <p className="text-sm text-text">{t('kyc.resubmit.intro')}</p>
        <StatusBanner kind="DEMO" />
        {PHOTOS.map((p) => (
          <Controller
            key={p.name}
            name={p.name}
            control={control}
            render={({ field, fieldState }) => (
              <ImagePicker
                label={t(p.label)}
                capture={'capture' in p ? p.capture : undefined}
                onChange={(file) => field.onChange(file ?? undefined)}
                error={fieldState.error?.message && t(fieldState.error.message)}
              />
            )}
          />
        ))}
        {failure != null && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(t, failure)}
          </p>
        )}
        <Button type="submit" loading={isSubmitting} className="mt-auto">
          {t('kyc.resubmit.submit')}
        </Button>
      </form>
    </AppShell>
  )
}
