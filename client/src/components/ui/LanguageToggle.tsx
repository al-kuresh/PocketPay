import { useTranslation } from 'react-i18next'
import { useLanguage, type Lang } from '../../stores/language'

const LANGS: Lang[] = ['en', 'bn']

/** English / বাংলা. Each name is shown in its own language. */
export function LanguageToggle() {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const setLang = useLanguage((s) => s.setLang)
  return (
    <div role="group" aria-label={t('language.label')} className="inline-flex gap-1 rounded-xl border border-border-strong p-1">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
          className={`min-h-11 min-w-11 rounded-xl px-3 text-sm transition-colors duration-150 ease-out-quint ${lang === l ? 'bg-primary-dark font-semibold text-white' : 'text-text hover:bg-surface-sunken'}`}
        >
          {t(`language.${l}`)}
        </button>
      ))}
    </div>
  )
}
