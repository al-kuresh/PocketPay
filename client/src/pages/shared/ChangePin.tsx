import { zodResolver } from '@hookform/resolvers/zod'
import { useRef, useState } from 'react'
import { useController, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { z } from 'zod'
import { changePin } from '../../api/me'
import { AppShell } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { PinInput, type PinInputHandle } from '../../components/ui/PinInput'
import { useToast } from '../../components/ui/toast-context'
import { errorMessage } from '../../i18n/errors'
import { newPinSchema, pinSchema } from '../../lib/validation'

// The new PIN follows registration's strength rules (newPinSchema); "same as the current one" is the server's PIN_UNCHANGED.
const schema = z
  .object({ currentPin: pinSchema, newPin: newPinSchema, confirmPin: z.string() })
  .refine((v) => v.newPin === v.confirmPin, { path: ['confirmPin'], message: 'validation.pinMismatch' })

type Values = z.infer<typeof schema>

/** Current PIN, new PIN, confirm → PATCH /auth/pin. The three PINs are cleared after every request, success or failure. */
export function ChangePin() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const [failure, setFailure] = useState<unknown>(null)
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: { currentPin: '', newPin: '', confirmPin: '' } })
  const fields = [
    { label: 'changePin.current', input: useRef<PinInputHandle>(null), ctl: useController({ name: 'currentPin', control }) },
    { label: 'changePin.new', input: useRef<PinInputHandle>(null), ctl: useController({ name: 'newPin', control }) },
    { label: 'changePin.confirm', input: useRef<PinInputHandle>(null), ctl: useController({ name: 'confirmPin', control }) },
  ]

  async function submit(v: Values) {
    setFailure(null)
    try {
      await changePin(v.currentPin, v.newPin)
      toast.show(t('changePin.done'), 'success')
      void navigate('/profile', { replace: true })
    } catch (e) {
      setFailure(e) // INVALID_PIN (attempts left), PIN_UNCHANGED, ACCOUNT_LOCKED (until), ...
    } finally {
      for (const f of fields) f.input.current?.clear()
    }
  }

  return (
    <AppShell title={t('changePin.title')} onBack={() => void navigate('/profile')}>
      <form noValidate onSubmit={(e) => void handleSubmit(submit)(e)} className="flex flex-1 flex-col gap-6">
        {fields.map((f) => (
          <PinInput
            key={f.label}
            ref={f.input}
            label={t(f.label)}
            onChange={f.ctl.field.onChange}
            error={f.ctl.fieldState.error?.message && t(f.ctl.fieldState.error.message)}
          />
        ))}
        {failure != null && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(t, failure)}
          </p>
        )}
        <Button type="submit" loading={isSubmitting} className="mt-auto">
          {t('changePin.submit')}
        </Button>
      </form>
    </AppShell>
  )
}
