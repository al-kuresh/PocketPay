import { describe, expect, it } from 'vitest'
import { formatDateTime, greetingKey } from './dates'

describe('formatDateTime (always Asia/Dhaka)', () => {
  it('en', () => {
    expect(formatDateTime('2026-11-24T18:30:00Z', 'en')).toBe('25 Nov 2026, 12:30 am')
  })

  it('bn: the same moment with Bangla digits', () => {
    expect(formatDateTime('2026-11-24T18:30:00Z', 'bn')).toBe('২৫ নভে, ২০২৬, ১২:৩০ AM')
  })
})

describe('greetingKey (the Dhaka hour, whatever the phone says)', () => {
  it.each([
    ['2026-11-24T23:00:00Z', 'morning'], // 05:00 in Dhaka
    ['2026-11-25T05:59:00Z', 'morning'], // 11:59
    ['2026-11-25T06:00:00Z', 'afternoon'], // 12:00
    ['2026-11-25T10:59:00Z', 'afternoon'], // 16:59
    ['2026-11-25T11:00:00Z', 'evening'], // 17:00
    ['2026-11-24T22:59:00Z', 'evening'], // 04:59: still the night before
  ])('%s → %s', (iso, key) => {
    expect(greetingKey(new Date(iso))).toBe(key)
  })
})
