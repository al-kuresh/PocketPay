import { describe, expect, it } from 'vitest'
import apiDoc from '../../../docs/api.md?raw'
import { ApiError } from '../api/client'
import bn from './bn.json'
import en from './en.json'
import { ERROR_CODES, errorMessage } from './errors'
import { i18n } from './index'

/** Every leaf as [dotted.key, value]. */
function leaves(obj: object, prefix = ''): Array<[string, unknown]> {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? leaves(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v] as [string, unknown]],
  )
}
const keys = (obj: object) => leaves(obj).map(([k]) => k).sort()

describe('translations', () => {
  it('en and bn have exactly the same keys, nested ones included', () => {
    expect(keys(bn)).toEqual(keys(en))
  })

  it('no value is empty and every value is a string', () => {
    for (const [key, value] of [...leaves(en), ...leaves(bn)]) {
      expect(typeof value, key).toBe('string')
      expect((value as string).trim(), key).not.toBe('')
    }
  })
})

describe('error codes', () => {
  it('ERROR_CODES covers every code in the docs/api.md error tables', () => {
    const section = apiDoc.slice(apiDoc.indexOf('## Error codes'))
    const documented = [...section.matchAll(/^\| `([A-Z_]+)` \| \d{3} \|/gm)].map((m) => m[1])
    expect(documented.length).toBeGreaterThan(40)
    expect(documented.filter((c) => !ERROR_CODES.includes(c as never))).toEqual([])
  })

  it('every code, NETWORK_ERROR and GENERIC have an errors.<CODE> key in both files', () => {
    expect(ERROR_CODES).toContain('NETWORK_ERROR')
    for (const code of [...ERROR_CODES, 'GENERIC']) {
      expect(en.errors, code).toHaveProperty([code])
      expect(bn.errors, code).toHaveProperty([code])
    }
  })

  const t = i18n.getFixedT('en')

  it('a known code → its translated message (en and bn)', () => {
    const err = new ApiError(422, 'INSUFFICIENT_BALANCE', 'server text')
    expect(errorMessage(t, err)).toBe(en.errors.INSUFFICIENT_BALANCE)
    expect(errorMessage(i18n.getFixedT('bn'), err)).toBe(bn.errors.INSUFFICIENT_BALANCE)
    expect(errorMessage(t, new ApiError(0, 'NETWORK_ERROR', 'Network Error'))).toBe(en.errors.NETWORK_ERROR)
  })

  it('an unknown code → the generic text, never the server message', () => {
    const msg = errorMessage(t, new ApiError(418, 'BRAND_NEW_CODE', 'raw server text'))
    expect(msg).toBe(en.errors.GENERIC)
    expect(msg).not.toContain('raw server text')
  })

  it('anything that is not an ApiError → the generic text', () => {
    expect(errorMessage(t, new Error('boom'))).toBe(en.errors.GENERIC)
    expect(errorMessage(t, 'string')).toBe(en.errors.GENERIC)
    expect(errorMessage(t, undefined)).toBe(en.errors.GENERIC)
  })

  it('codes with attemptsLeft have plural keys in both files', () => {
    for (const code of ['INVALID_CREDENTIALS', 'INVALID_PIN', 'OTP_INVALID']) {
      for (const file of [en.errors, bn.errors]) {
        expect(file, code).toHaveProperty([`${code}_attempts_one`])
        expect(file, code).toHaveProperty([`${code}_attempts_other`])
      }
    }
  })

  it('INVALID_CREDENTIALS with attemptsLeft says how many are left (plural, Bangla digits in bn)', () => {
    const err = (n: number) => new ApiError(401, 'INVALID_CREDENTIALS', 'x', { attemptsLeft: n })
    expect(errorMessage(t, err(2))).toBe(en.errors.INVALID_CREDENTIALS_attempts_other.replace('{{count, number}}', '2'))
    expect(errorMessage(t, err(1))).toBe(en.errors.INVALID_CREDENTIALS_attempts_one.replace('{{count, number}}', '1'))
    const inBangla = errorMessage(i18n.getFixedT('bn'), err(2))
    expect(inBangla).toContain('২')
    expect(inBangla).not.toMatch(/[0-9]/)
  })

  it('INVALID_PIN and OTP_INVALID with attemptsLeft say it too', () => {
    expect(errorMessage(t, new ApiError(403, 'INVALID_PIN', 'x', { attemptsLeft: 2 }))).toContain('2')
    expect(errorMessage(t, new ApiError(400, 'OTP_INVALID', 'x', { attemptsLeft: 4 }))).toContain('4')
  })

  it('INVALID_CREDENTIALS without details (unknown phone) → the plain message', () => {
    expect(errorMessage(t, new ApiError(401, 'INVALID_CREDENTIALS', 'x'))).toBe(en.errors.INVALID_CREDENTIALS)
  })

  it('ACCOUNT_LOCKED with lockedUntil → the unlock time in Dhaka, in the language of t', () => {
    const err = new ApiError(423, 'ACCOUNT_LOCKED', 'x', { lockedUntil: '2026-11-24T18:30:00Z' })
    expect(errorMessage(t, err)).toContain('25 Nov 2026, 12:30 am')
    expect(errorMessage(i18n.getFixedT('bn'), err)).toContain('২৫ নভে, ২০২৬, ১২:৩০ AM')
    expect(errorMessage(t, new ApiError(423, 'ACCOUNT_LOCKED', 'x'))).toBe(en.errors.ACCOUNT_LOCKED)
  })

  it('details of the wrong shape are ignored (no "{{count}}" or "Invalid Date" leaks)', () => {
    const odd = [
      new ApiError(401, 'INVALID_CREDENTIALS', 'x', { attemptsLeft: '2' }),
      new ApiError(423, 'ACCOUNT_LOCKED', 'x', { lockedUntil: 'soon' }),
      new ApiError(400, 'VALIDATION_ERROR', 'x', [{ path: 'phone', message: 'bad' }]),
    ]
    for (const err of odd) {
      const msg = errorMessage(t, err)
      expect(msg).toBe(en.errors[err.code as keyof typeof en.errors])
    }
  })
})
