import { describe, expect, it } from 'vitest'
import moneySource from './money.ts?raw'
import keypadSource from '../components/ui/AmountKeypad.tsx?raw'
import flowSource from '../features/transfer/TransferFlow.tsx?raw'
import { toAsciiDigits, toLangDigits } from './digits'
import { editAmount, formatTaka, takaToPoisha } from './money'

describe('formatTaka', () => {
  it.each([
    ['0', '৳0.00'],
    ['5', '৳0.05'],
    ['50000', '৳500.00'],
    ['150050', '৳1,500.50'],
    ['1234567', '৳12,345.67'],
    ['1234567890', '৳1,23,45,678.90'],
    // beyond Number.MAX_SAFE_INTEGER / 100: still exact
    ['99999999999999', '৳9,99,99,99,99,999.99'],
    ['900719925474099199', '৳9,00,71,99,25,47,40,991.99'],
  ])('%s → %s', (poisha, expected) => {
    expect(formatTaka(poisha)).toBe(expected)
  })

  it('sign: out uses U+2212, in uses +', () => {
    expect(formatTaka('50000', { sign: 'out' })).toBe('−৳500.00')
    expect(formatTaka('50000', { sign: 'in' })).toBe('+৳500.00')
  })

  it('bn → Bangla digits with the same lakh grouping', () => {
    expect(formatTaka('150050', { lang: 'bn' })).toBe('৳১,৫০০.৫০')
    expect(formatTaka('1234567890', { lang: 'bn' })).toBe('৳১,২৩,৪৫,৬৭৮.৯০')
    expect(formatTaka('5', { lang: 'bn', sign: 'out' })).toBe('−৳০.০৫')
  })

  it('refuses anything that is not a poisha string', () => {
    for (const bad of ['', '-5', '1.5', 'abc', ' 5']) expect(() => formatTaka(bad)).toThrow(RangeError)
  })
})

describe('takaToPoisha', () => {
  it.each([
    ['500', '50000'],
    ['1,500.50', '150050'],
    ['0.5', '50'],
    ['100.1', '10010'],
    ['১৫০০.৫০', '150050'],
    ['১,৫০০', '150000'],
    [' 20 ', '2000'],
    ['0.01', '1'],
    ['99999999999999.99', '9999999999999999'],
  ])('%j → %s', (input, expected) => {
    expect(takaToPoisha(input)).toBe(expected)
  })

  it.each(['1.234', '-5', '1e3', '', 'abc', '0', '0.00', '.', '.5', '5.', '+5', '1 000', 'Infinity', '৳500'])(
    '%j → null',
    (input) => {
      expect(takaToPoisha(input)).toBeNull()
    },
  )
})

describe('money.ts never touches floats', () => {
  it('has no Number(), parseFloat, parseInt, Math or toFixed', () => {
    expect(moneySource).not.toMatch(/\bNumber\s*\(|parseFloat|parseInt|\bMath\.|toFixed/)
  })
})

describe('toAsciiDigits', () => {
  it('maps Bangla digits and leaves the rest', () => {
    expect(toAsciiDigits('০১৭')).toBe('017')
    expect(toAsciiDigits('০১৭00-৯ab')).toBe('01700-9ab')
  })
})

describe('editAmount (the keypad and keyboard rule: what may be typed next)', () => {
  it.each([
    ['', '5', '5'],
    ['5', '50', '50'],
    ['50', '500.', '500.'],
    ['500.', '500.5', '500.5'],
    ['500.5', '500.55', '500.55'],
    ['500.55', '500.555', '500.55'], // a 3rd decimal is refused: the text stays
    ['1.5', '1.5.', '1.5'], // a second point is refused
    ['', '.', '0.'], // a point first reads as 0.
    ['0', '05', '5'], // no leading zeros
    ['', '০৫০০', '500'], // Bangla digits are stored as ASCII
    ['500', '500a', '500'], // letters are refused
    ['500', '-500', '500'], // a sign is refused
    ['', '1,000', '1000'], // a pasted comma is dropped
    ['9999999', '99999999', '9999999'], // at most 7 digits before the point
    ['500', '', ''], // everything deleted
  ])('%j + typing → %j gives %j', (text, next, expected) => {
    expect(editAmount(text, next)).toBe(expected)
  })

  it('what it gives is read only by takaToPoisha', () => {
    expect(takaToPoisha(editAmount('', '12.5'))).toBe('1250')
    expect(takaToPoisha(editAmount('', '0.'))).toBeNull()
  })
})

describe('toLangDigits', () => {
  it('bn writes Bangla digits, en leaves the text', () => {
    expect(toLangDigits('1500.50', 'bn')).toBe('১৫০০.৫০')
    expect(toLangDigits('1500.50', 'en')).toBe('1500.50')
  })
})

describe('the amount entry never turns money into a float', () => {
  it.each([
    ['AmountKeypad.tsx', keypadSource],
    ['TransferFlow.tsx', flowSource],
  ])('%s has no Number(), parseFloat, parseInt, Math or toFixed', (_name, source) => {
    expect(source).not.toMatch(/\bNumber\s*\(|parseFloat|parseInt|\bMath\.|toFixed/)
  })
})
