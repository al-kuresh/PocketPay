import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, User as UserIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { logout, me } from '../../api/auth'
import { changePhoto } from '../../api/me'
import { AppShell } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ImagePicker } from '../../components/ui/ImagePicker'
import { LanguageToggle } from '../../components/ui/LanguageToggle'
import { useToast } from '../../components/ui/toast-context'
import { errorMessage } from '../../i18n/errors'
import { useSession } from '../../stores/session'

/** Who the user is, the language, Change PIN, Change photo and Log out. */
export function Profile() {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const sessionUser = useSession((s) => s.user)
  const user = useQuery({ queryKey: ['me'], queryFn: me }).data?.user ?? sessionUser
  // A new key after each upload empties the picker: the avatar above shows the saved photo, not the local preview.
  const [pickerKey, setPickerKey] = useState(0)
  const photo = useMutation({
    mutationFn: changePhoto,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      toast.show(t('profile.photoChanged'), 'success')
    },
    onSettled: () => setPickerKey((k) => k + 1),
  })
  // logout() drops the session even if the call fails; RequireAuth then goes to /login.
  const out = useMutation({ mutationFn: logout })

  if (!user) return null
  return (
    <AppShell title={t('nav.profile')} nav canvas>
      <div className="flex items-center gap-4">
        {user.profilePhotoUrl ? (
          <img src={user.profilePhotoUrl} alt={t('profile.photo')} className="size-16 rounded-full border border-border object-cover" />
        ) : (
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary-50">
            <UserIcon aria-hidden className="size-8 text-primary" />
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate font-display text-xl font-semibold text-text">{user.name}</p>
          <p className="text-sm tabular-nums text-text-muted">{user.phone}</p>
        </div>
      </div>

      <Card>
        <dl className="flex flex-col gap-3">
          <Row label={t('profile.nid')}>{user.nidMasked}</Row>
          <Row label={t('profile.role')}>{t(`roles.${user.role}`)}</Row>
          {user.shopName && <Row label={t('profile.shopName')}>{user.shopName}</Row>}
          <Row label={t('profile.status')}>{t(`status.${user.status}`)}</Row>
          <Row label={t('profile.kyc')}>{t(`kycStatus.${user.kycStatus ?? 'NONE'}`)}</Row>
        </dl>
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-text">{t('language.label')}</span>
          <LanguageToggle tone="surface" />
        </div>
        <Link
          to="/profile/pin"
          className="flex min-h-11 items-center justify-between border-t border-border pt-3 text-base text-text hover:text-primary-dark"
        >
          {t('profile.changePin')}
          <ChevronRight aria-hidden className="size-5 text-text-muted" />
        </Link>
      </Card>

      <ImagePicker
        key={pickerKey}
        label={t('profile.changePhoto')}
        onChange={(file) => file && photo.mutate(file)}
        error={photo.isError ? errorMessage(t, photo.error) : undefined}
      />

      <Button variant="secondary" loading={out.isPending} onClick={() => out.mutate()} className="mt-auto">
        {t('common.logout')}
      </Button>
    </AppShell>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="text-right text-sm tabular-nums text-text">{children}</dd>
    </div>
  )
}
