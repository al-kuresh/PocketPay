import { create } from 'zustand'
import { i18n } from '../i18n'

export type Lang = 'en' | 'bn'

const KEY = 'pocketpay.lang' // the only thing the app keeps in localStorage

function saved(): Lang {
  try {
    return localStorage.getItem(KEY) === 'bn' ? 'bn' : 'en'
  } catch {
    return 'en' // storage blocked (private mode): just use the default
  }
}

function apply(lang: Lang) {
  void i18n.changeLanguage(lang)
  document.documentElement.lang = lang
}

interface LanguageState {
  lang: Lang
  setLang(lang: Lang): void
}

export const useLanguage = create<LanguageState>()((set) => ({
  lang: saved(),
  setLang: (lang) => {
    try {
      localStorage.setItem(KEY, lang)
    } catch {
      // storage blocked: still switch, it just won't be remembered
    }
    apply(lang)
    set({ lang })
  },
}))

apply(useLanguage.getState().lang)
