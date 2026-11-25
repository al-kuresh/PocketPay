import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { z } from 'zod'
import { requestOtp } from '../../../api/register'
import type { OtpSent } from '../../../api/types'
import { Button } from '../../../components/ui/Button'
import { PhoneInput } from '../../../components/ui/PhoneInput'
import { errorMessage } from '../../../i18n/errors'
import { phoneSchema } from '../../../lib/validation'

const schema = z.object({ phone: phoneSchema })

interface PhoneStepProps {
  defaultPhone: string
  /** Why the wizard came back here (an expired registration token), shown until the next try. */
  notice: unknown
  onDone(phone: string, sent: OtpSent): void
}

export function PhoneStep({ defaultPhone, notice, onDone }: PhoneStepProps) {
  const { t } = useTranslation()
  const [failure, setFailure] = useState<unknown>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: { phone: defaultPhone } })

  async function submit({ phone }: { phone: string }) {
    setFailure(null)
    try {
      const sent = await requestOtp(phone)
      onDone(phone, sent)
    } catch (e) {
      setFailure(e)
    }
  }

  const shown = failure ?? notice
  return (
    <form noValidate onSubmit={handleSubmit(submit)} className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold text-text">{t('register.phone.heading')}</h2>
        <p className="text-sm text-text-muted">{t('register.phone.hint')}</p>
      </div>
      <PhoneInput label={t('register.phone.label')} error={errors.phone && t(errors.phone.message ?? '')} {...register('phone')} />
      {shown != null && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, shown)}
        </p>
      )}
      <div className="mt-auto flex flex-col gap-3">
        <Button type="submit" loading={isSubmitting}>
          {t('register.phone.submit')}
        </Button>
        <p className="text-center text-sm text-text-muted">
          {t('register.haveAccount')}{' '}
          <Link to="/login" className="inline-flex min-h-11 min-w-11 items-center justify-center font-semibold text-primary-dark">
            {t('register.login')}
          </Link>
        </p>
      </div>
    </form>
  )
}
