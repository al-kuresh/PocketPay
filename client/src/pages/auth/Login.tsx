import { zodResolver } from '@hookform/resolvers/zod'
import { useRef, useState } from 'react'
import { useController, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { z } from 'zod'
import { login } from '../../api/auth'
import type { Role } from '../../api/types'
import { AppShell } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { LanguageToggle } from '../../components/ui/LanguageToggle'
import { PhoneInput } from '../../components/ui/PhoneInput'
import { PinInput, type PinInputHandle } from '../../components/ui/PinInput'
import { errorMessage } from '../../i18n/errors'
import { phoneSchema, pinSchema } from '../../lib/validation'

const schema = z.object({ phone: phoneSchema, pin: pinSchema })

// The seeded demo accounts (server/src/db/seed.ts). Public on purpose: the live demo is for recruiters.
const DEMO_PIN = '48213'
const DEMO: Array<{ role: Role; phone: string }> = [
  { role: 'CUSTOMER', phone: '01800000002' },
  { role: 'AGENT', phone: '01800000004' },
  { role: 'MERCHANT', phone: '01800000005' },
  { role: 'ADMIN', phone: '01800000001' },
]

/** Phone + PIN, or one tap on a demo account. On success RequireAnonymous sends the user to their home. */
export function Login() {
  const { t } = useTranslation()
  const pinRef = useRef<PinInputHandle>(null)
  const [failure, setFailure] = useState<unknown>(null)
  const [busy, setBusy] = useState<'form' | Role | null>(null)
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues: { phone: '', pin: '' } })
  const pin = useController({ name: 'pin', control })

  async function signIn(phone: string, pin: string, by: 'form' | Role) {
    setBusy(by)
    setFailure(null)
    try {
      await login(phone, pin)
    } catch (e) {
      setFailure(e)
    } finally {
      setBusy(null)
      pinRef.current?.clear() // after every submit, success or failure
    }
  }

  return (
    <AppShell headerEnd={<LanguageToggle />}>
      <div className="flex flex-col gap-2">
        <p className="text-3xl font-semibold text-primary">{t('app.name')}</p>
        <h1 className="text-xl font-semibold text-text">{t('login.title')}</h1>
      </div>

      <form noValidate onSubmit={(e) => void handleSubmit((v) => signIn(v.phone, v.pin, 'form'))(e)} className="flex flex-col gap-4">
        <PhoneInput label={t('login.phone')} error={errors.phone && t(errors.phone.message ?? '')} {...register('phone')} />
        <PinInput
          ref={pinRef}
          label={t('login.pin')}
          onChange={pin.field.onChange}
          error={pin.fieldState.error && t(pin.fieldState.error.message ?? '')}
        />
        {failure != null && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(t, failure)}
          </p>
        )}
        <Button type="submit" loading={busy === 'form'} disabled={busy !== null}>
          {t('login.submit')}
        </Button>
      </form>

      <p className="text-sm text-text-muted">
        {t('login.noAccount')}{' '}
        <Link to="/register" className="inline-flex min-h-11 items-center font-semibold text-primary-dark">
          {t('login.register')}
        </Link>
      </p>

      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-base font-semibold text-text">{t('login.demo.title')}</h2>
        <p className="text-sm text-text-muted">{t('login.demo.hint')}</p>
        <div className="grid grid-cols-2 gap-3">
          {DEMO.map(({ role, phone }) => (
            <Button
              key={role}
              variant="secondary"
              loading={busy === role}
              disabled={busy !== null}
              onClick={() => signIn(phone, DEMO_PIN, role)}
            >
              {t(`login.demo.${role}`)}
            </Button>
          ))}
        </div>
      </section>
    </AppShell>
  )
}
