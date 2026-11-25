import { zodResolver } from '@hookform/resolvers/zod'
import { useRef, useState } from 'react'
import { Controller, useController, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { ApiError } from '../../../api/client'
import { completeRegistration } from '../../../api/register'
import { Button } from '../../../components/ui/Button'
import { ImagePicker } from '../../../components/ui/ImagePicker'
import { PinInput, type PinInputHandle } from '../../../components/ui/PinInput'
import { StatusBanner } from '../../../components/ui/StatusBanner'
import { errorMessage } from '../../../i18n/errors'
import { newPinSchema } from '../../../lib/validation'
import type { Identity } from './IdentityStep'

const photo = z.instanceof(File, { message: 'validation.photo' })

const schema = z
  .object({ nidFront: photo, nidBack: photo, selfie: photo, pin: newPinSchema, confirmPin: z.string() })
  .refine((v) => v.pin === v.confirmPin, { path: ['confirmPin'], message: 'validation.pinMismatch' })

type Values = z.infer<typeof schema>

const PHOTOS = [
  { name: 'nidFront', label: 'register.photos.nidFront' },
  { name: 'nidBack', label: 'register.photos.nidBack' },
  { name: 'selfie', label: 'register.photos.selfie', capture: 'user' },
] as const

interface PhotosAndPinStepProps {
  registrationToken: string
  identity: Identity
  /** The token expired or was used: the wizard restarts at step 1 with this error. */
  onExpired(error: ApiError): void
}

/** Step 4: the 3 photos and the new PIN, sent with step 3's fields as ONE multipart request, which logs the user in. */
export function PhotosAndPinStep({ registrationToken, identity, onExpired }: PhotosAndPinStepProps) {
  const { t } = useTranslation()
  const pinRef = useRef<PinInputHandle>(null)
  const confirmRef = useRef<PinInputHandle>(null)
  const [failure, setFailure] = useState<unknown>(null)
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: { pin: '', confirmPin: '' } })
  const pin = useController({ name: 'pin', control })
  const confirmPin = useController({ name: 'confirmPin', control })

  async function submit(v: Values) {
    setFailure(null)
    const form = new FormData()
    form.append('name', identity.name)
    form.append('dateOfBirth', identity.dateOfBirth)
    form.append('nidNumber', identity.nidNumber)
    form.append('role', identity.role)
    if (identity.shopName) form.append('shopName', identity.shopName)
    form.append('pin', v.pin)
    form.append('confirmPin', v.confirmPin)
    form.append('nidFront', v.nidFront)
    form.append('nidBack', v.nidBack)
    form.append('selfie', v.selfie)
    try {
      await completeRegistration(registrationToken, form) // logged in: RequireAnonymous sends the user home
    } catch (e) {
      if (e instanceof ApiError && e.code === 'REGISTRATION_TOKEN_INVALID') onExpired(e)
      else setFailure(e)
    } finally {
      pinRef.current?.clear() // after every submit, success or failure
      confirmRef.current?.clear()
    }
  }

  const message = (key?: string) => key && t(key)
  return (
    <form noValidate onSubmit={(e) => void handleSubmit(submit)(e)} className="flex flex-1 flex-col gap-6">
      <h2 className="text-xl font-semibold text-text">{t('register.photos.heading')}</h2>
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
              error={message(fieldState.error?.message)}
            />
          )}
        />
      ))}
      <PinInput
        ref={pinRef}
        label={t('register.photos.pin')}
        onChange={pin.field.onChange}
        error={message(pin.fieldState.error?.message)}
      />
      <PinInput
        ref={confirmRef}
        label={t('register.photos.confirmPin')}
        onChange={confirmPin.field.onChange}
        error={message(confirmPin.fieldState.error?.message)}
      />
      {failure != null && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, failure)}
        </p>
      )}
      <Button type="submit" loading={isSubmitting} className="mt-auto">
        {t('register.photos.submit')}
      </Button>
    </form>
  )
}
