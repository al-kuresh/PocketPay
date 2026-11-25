import { useTranslation } from 'react-i18next'
import { useLanguage, type Lang } from '../../stores/language'

const LANGS: Lang[] = ['en', 'bn']

const TONES = {
  // On the orange app bar: the default, that's where it usually lives.
  brand: { group: 'border-white', on: 'bg-white font-semibold text-primary-dark', off: 'text-white hover:bg-primary-darker' },
  surface: { group: 'border-border-strong', on: 'bg-primary-dark font-semibold text-white', off: 'text-text hover:bg-surface-sunken' },
}

/** English / বাংলা. Each name is shown in its own language. */
export function LanguageToggle({ tone = 'brand' }: { tone?: keyof typeof TONES }) {
  const c = TONES[tone]
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const setLang = useLanguage((s) => s.setLang)
  return (
    <div role="group" aria-label={t('language.label')} className={`inline-flex gap-1 rounded-xl border p-1 ${c.group}`}>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
          className={`min-h-11 min-w-11 rounded-xl px-3 text-sm transition-colors duration-150 ease-out-quint ${lang === l ? c.on : c.off}`}
        >
          {t(`language.${l}`)}
        </button>
      ))}
    </div>
  )
}
