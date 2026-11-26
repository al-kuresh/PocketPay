import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { ApiError } from '../../../api/client'
import { requestOtp, verifyOtp } from '../../../api/register'
import type { OtpSent } from '../../../api/types'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { errorMessage } from '../../../i18n/errors'
import { otpSchema } from '../../../lib/validation'

const schema = z.object({ code: otpSchema })

interface OtpStepProps {
  phone: string
  /** The request-otp answer: its devOtp is present only when the server echoes codes (dev and demo: no SMS gateway). */
  sent: OtpSent
  onDone(registrationToken: string): void
}

export function OtpStep({ phone, sent, onDone }: OtpStepProps) {
  const { t } = useTranslation()
  const [failure, setFailure] = useState<unknown>(null)
  const [devOtp, setDevOtp] = useState(sent.devOtp)
  // Seconds until "Resend" works (the server's 60 s cooldown). A throttled background tab only makes it late,
  // and then the server's OTP_COOLDOWN answer resets it.
  const [wait, setWait] = useState(sent.resendInSeconds)
  const [resending, setResending] = useState(false)
  useEffect(() => {
    if (wait <= 0) return
    const id = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(id)
  }, [wait])
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

  async function resend() {
    setFailure(null)
    setResending(true)
    try {
      const next = await requestOtp(phone)
      setDevOtp(next.devOtp)
      setWait(next.resendInSeconds)
    } catch (e) {
      setFailure(e)
      const retryAfter = e instanceof ApiError && e.code === 'OTP_COOLDOWN' ? (e.details as { retryAfterSeconds?: number })?.retryAfterSeconds : undefined
      if (typeof retryAfter === 'number') setWait(retryAfter)
    } finally {
      setResending(false)
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit(submit)} className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-semibold text-text">{t('register.otp.heading')}</h2>
        <p className="text-sm text-text-muted">{t('register.otp.sentTo', { phone })}</p>
      </div>
      {devOtp && <p className="rounded-3xl bg-primary-50 p-4 text-sm text-text">{t('register.otp.devHint', { code: devOtp })}</p>}
      <div className="flex flex-col gap-2">
        <Input
          label={t('register.otp.label')}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="tabular-nums"
          error={errors.code && t(errors.code.message ?? '')}
          {...register('code')}
        />
        <Button variant="ghost" loading={resending} disabled={wait > 0} onClick={() => void resend()} className="-ml-3 self-start">
          {wait > 0 ? t('register.otp.resendIn', { seconds: wait }) : t('register.otp.resend')}
        </Button>
      </div>
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
