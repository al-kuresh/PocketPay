import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
import { useLanguage } from './language'

afterEach(() => {
  useLanguage.getState().setLang('en')
  localStorage.clear()
  vi.restoreAllMocks()
})

/** A fresh copy of the store module (and i18n), as on a page load with what is in localStorage now. */
async function load() {
  vi.resetModules()
  const store = await import('./language')
  const fresh = await import('../i18n')
  return { lang: store.useLanguage.getState().lang, i18nLang: fresh.i18n.language }
}

describe('language store', () => {
  it('defaults to en, applied to i18next and <html lang>', async () => {
    expect(await load()).toEqual({ lang: 'en', i18nLang: 'en' })
    expect(document.documentElement.lang).toBe('en')
  })

  it('setLang switches i18next and <html lang>, and stores only the language', () => {
    useLanguage.getState().setLang('bn')
    expect(useLanguage.getState().lang).toBe('bn')
    expect(i18n.language).toBe('bn')
    expect(document.documentElement.lang).toBe('bn')
    expect(localStorage.length).toBe(1)
    expect(Object.values(localStorage)).toEqual(['bn'])
    expect(sessionStorage.length).toBe(0)
  })

  it('a saved bn is restored on load', async () => {
    useLanguage.getState().setLang('bn')
    document.documentElement.lang = 'en'
    expect(await load()).toEqual({ lang: 'bn', i18nLang: 'bn' })
    expect(document.documentElement.lang).toBe('bn')
  })

  it('a garbage saved value → en', async () => {
    useLanguage.getState().setLang('bn')
    localStorage.setItem(localStorage.key(0)!, 'fr')
    expect((await load()).lang).toBe('en')
  })

  it('storage that throws (private mode) still works: en on load, switching still applies', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect((await load()).lang).toBe('en')
    useLanguage.getState().setLang('bn')
    expect(document.documentElement.lang).toBe('bn')
  })
})
