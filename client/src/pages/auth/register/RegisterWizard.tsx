import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { OtpSent } from '../../../api/types'
import { AppShell } from '../../../components/layout/AppShell'
import { LanguageToggle } from '../../../components/ui/LanguageToggle'
import { IdentityStep, type Identity } from './IdentityStep'
import { OtpStep } from './OtpStep'
import { PhoneStep } from './PhoneStep'
import { PhotosAndPinStep } from './PhotosAndPinStep'

const STEPS = 4

function Progress({ step }: { step: number }) {
  const { t } = useTranslation()
  const label = t('register.progress', { step, total: STEPS })
  return (
    <div className="flex flex-col gap-2">
      <div role="progressbar" aria-valuemin={1} aria-valuemax={STEPS} aria-valuenow={step} aria-label={label} className="flex gap-2">
        {Array.from({ length: STEPS }, (_, i) => (
          <div key={i} className={`h-1 flex-1 rounded-full ${i < step ? 'bg-primary-dark' : 'bg-border'}`} />
        ))}
      </div>
      <p className="text-sm text-text-muted">{label}</p>
    </div>
  )
}

/** Registration (design §6.1): phone → OTP → identity → photos + PIN. */
export function RegisterWizard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [phone, setPhone] = useState('')
  const [sent, setSent] = useState<OtpSent | null>(null)
  // React state only: never localStorage, sessionStorage or the URL. A reload drops it (the user starts again).
  const [registrationToken, setRegistrationToken] = useState<string | null>(null)
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [restartReason, setRestartReason] = useState<unknown>(null)

  function restart(reason: unknown) {
    setRegistrationToken(null)
    setRestartReason(reason)
    setStep(1)
  }

  function back() {
    if (step === 1) navigate('/login')
    else if (step === 4) setStep(3)
    else restart(null) // the code was used up by verify-otp, so before step 4 "back" means a new code
  }

  return (
    <AppShell title={t('register.title')} onBack={back} headerEnd={<LanguageToggle />}>
      <Progress step={step} />
      {step === 1 && (
        <PhoneStep
          defaultPhone={phone}
          notice={restartReason}
          onDone={(p, answer) => {
            setPhone(p)
            setSent(answer)
            setRestartReason(null)
            setStep(2)
          }}
        />
      )}
      {step === 2 && sent && (
        <OtpStep
          phone={phone}
          sent={sent}
          onDone={(token) => {
            setRegistrationToken(token)
            setStep(3)
          }}
        />
      )}
      {step === 3 && (
        <IdentityStep
          defaultValues={identity}
          onDone={(id) => {
            setIdentity(id)
            setStep(4)
          }}
        />
      )}
      {step === 4 && registrationToken && identity && (
        <PhotosAndPinStep registrationToken={registrationToken} identity={identity} onExpired={restart} />
      )}
    </AppShell>
  )
}
