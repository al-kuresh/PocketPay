import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { verifyOtp } from '../../../api/register'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { errorMessage } from '../../../i18n/errors'
import { otpSchema } from '../../../lib/validation'

const schema = z.object({ code: otpSchema })

interface OtpStepProps {
  phone: string
  /** Present only when the server echoes codes (dev and demo: there is no SMS gateway). */
  devOtp?: string
  onDone(registrationToken: string): void
}

export function OtpStep({ phone, devOtp, onDone }: OtpStepProps) {
  const { t } = useTranslation()
  const [failure, setFailure] = useState<unknown>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: { code: '' } })

  async function submit({ code }: { code: string }) {
    setFailure(null)
    try {
      const { registrationToken } = await verifyOtp(phone, code)
      onDone(registrationToken)
    } catch (e) {
      setFailure(e)
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit(submit)} className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold text-text">{t('register.otp.heading')}</h2>
        <p className="text-sm text-text-muted">{t('register.otp.sentTo', { phone })}</p>
      </div>
      {devOtp && <p className="rounded-xl bg-primary-50 p-4 text-sm text-text">{t('register.otp.devHint', { code: devOtp })}</p>}
      <Input
        label={t('register.otp.label')}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        className="tabular-nums"
        error={errors.code && t(errors.code.message ?? '')}
        {...register('code')}
      />
      {failure != null && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, failure)}
        </p>
      )}
      <Button type="submit" loading={isSubmitting} className="mt-auto">
        {t('register.otp.submit')}
      </Button>
    </form>
  )
}
