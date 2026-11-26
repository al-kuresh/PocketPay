import { useTranslation } from 'react-i18next'
import { useLanguage } from '../../stores/language'

const TONES = {
  // On the orange app bar and the Home block: the default, that's where it usually lives.
  brand: 'border-thread text-white hover:bg-primary-darker',
  surface: 'border-border-strong text-primary-dark hover:bg-primary-50',
}

/** One pill, like the canvas: it names the other language in that language ("বাংলা" while in English) and switches to it. */
export function LanguageToggle({ tone = 'brand' }: { tone?: keyof typeof TONES }) {
  const { t } = useTranslation()
  const lang = useLanguage((s) => s.lang)
  const setLang = useLanguage((s) => s.setLang)
  const other = lang === 'en' ? 'bn' : 'en'
  return (
    <button
      type="button"
      lang={other}
      onClick={() => setLang(other)}
      className={`min-h-11 min-w-11 rounded-full border px-4 font-display text-base font-semibold transition duration-150 ease-out-quint active:scale-95 ${TONES[tone]}`}
    >
      {t(`language.${other}`)}
    </button>
  )
}
