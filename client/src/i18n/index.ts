import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { formatDateTime } from '../lib/dates'
import bn from './bn.json'
import en from './en.json'

// Our own instance (not the global singleton). Starts in English; stores/language.ts applies the saved choice.
export const i18n = i18next.createInstance()

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, bn: { translation: bn } },
  lng: 'en',
  fallbackLng: 'en', // never shows a raw key; the parity test keeps bn complete anyway
  interpolation: { escapeValue: false }, // React already escapes
  initAsync: false, // the resources are bundled, so be ready before the first render
})

// "{{until, dhakaTime}}" in a message: an ISO time shown in Dhaka time, in the message's language.
i18n.services.formatter?.add('dhakaTime', (value, lng) => formatDateTime(String(value), lng === 'bn' ? 'bn' : 'en'))
