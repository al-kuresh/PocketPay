import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { dhakaToday } from '../../../lib/dates'
import { dobSchema, nidSchema } from '../../../lib/validation'

const ROLES = ['CUSTOMER', 'AGENT', 'MERCHANT'] as const

const EMPTY = { name: '', dateOfBirth: '', nidNumber: '', role: 'CUSTOMER' as (typeof ROLES)[number], shopName: '' }

const schema = z
  .object({
    name: z.string().trim().min(2, 'validation.name').max(60, 'validation.name'),
    dateOfBirth: dobSchema,
    nidNumber: nidSchema,
    role: z.enum(ROLES),
    shopName: z.string().trim(),
  })
  .superRefine((v, ctx) => {
    if (v.role === 'MERCHANT' && (v.shopName.length < 2 || v.shopName.length > 80)) {
      ctx.addIssue({ code: 'custom', path: ['shopName'], message: 'validation.shopName' })
    }
  })

export interface Identity {
  name: string
  dateOfBirth: string
  nidNumber: string
  role: (typeof ROLES)[number]
  /** Merchants only. */
  shopName?: string
}

interface IdentityStepProps {
  /** Kept when the user comes back from step 4. */
  defaultValues: Identity | null
  onDone(identity: Identity): void
}

export function IdentityStep({ defaultValues, onDone }: IdentityStepProps) {
  const { t } = useTranslation()
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    // Coming back from step 4: a customer's or agent's shopName is undefined, but the field is always a string.
    defaultValues: defaultValues ? { ...defaultValues, shopName: defaultValues.shopName ?? '' } : EMPTY,
  })
  const role = useWatch({ control, name: 'role' })
  const message = (key?: string) => key && t(key)

  return (
    <form
      noValidate
      onSubmit={handleSubmit((v) => onDone({ ...v, shopName: v.role === 'MERCHANT' ? v.shopName : undefined }))}
      className="flex flex-1 flex-col gap-6"
    >
      <h2 className="font-display text-xl font-semibold text-text">{t('register.identity.heading')}</h2>
      <Input label={t('register.identity.name')} autoComplete="name" error={message(errors.name?.message)} {...register('name')} />
      <Input
        label={t('register.identity.dob')}
        type="date"
        max={dhakaToday()}
        error={message(errors.dateOfBirth?.message)}
        {...register('dateOfBirth')}
      />
      <Input
        label={t('register.identity.nid')}
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        className="tabular-nums"
        error={message(errors.nidNumber?.message)}
        {...register('nidNumber')}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm text-text">{t('register.identity.role')}</legend>
        <div className="grid grid-cols-3 gap-2">
          {ROLES.map((r) => (
            <label
              key={r}
              className="flex h-12 cursor-pointer items-center justify-center rounded-xl border border-border-strong text-sm text-text has-checked:border-primary-dark has-checked:bg-primary-50 has-checked:font-semibold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary-dark"
            >
              <input type="radio" value={r} className="sr-only" {...register('role')} />
              {t(`roles.${r}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {role === 'MERCHANT' && (
        <Input label={t('register.identity.shopName')} error={message(errors.shopName?.message)} {...register('shopName')} />
      )}
      <Button type="submit" className="mt-auto">
        {t('register.identity.submit')}
      </Button>
    </form>
  )
}
