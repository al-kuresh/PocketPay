import { describe, expect, it } from 'vitest'
import { formatDateTime, formatWhen, greetingKey } from './dates'

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

describe('formatWhen: list rows, by the Dhaka day (UTC+6), whatever the phone says', () => {
  // 16:00 on 25 Nov in Dhaka (10:00 UTC).
  const now = new Date('2026-11-25T10:00:00Z')

  it.each([
    ['2026-11-25T01:42:00Z', '7:42 am'], // today: just the time
    ['2026-11-24T18:00:00Z', '12:00 am'], // 00:00 on the 25th in Dhaka, still the 24th in UTC: today
    ['2026-11-24T17:59:59Z', 'Yesterday'], // 23:59 on the 24th in Dhaka
    ['2026-11-23T18:00:00Z', 'Yesterday'], // 00:00 on the 24th
    ['2026-11-23T17:59:59Z', '23 Nov'], // 23:59 on the 23rd: the date
    ['2026-01-01T00:00:00Z', '1 Jan'], // this year: no year
    ['2025-12-31T17:59:59Z', '31 Dec 2025'], // 23:59 on 31 Dec 2025 in Dhaka: another year
  ])('en: %s → %s', (iso, text) => {
    expect(formatWhen(iso, 'en', now)).toBe(text)
  })

  it('just after midnight in Dhaka (18:00 UTC the day before), 23:30 the evening before is Yesterday, not today', () => {
    const justAfterMidnight = new Date('2026-11-24T18:05:00Z') // 00:05 on the 25th in Dhaka
    expect(formatWhen('2026-11-24T17:30:00Z', 'en', justAfterMidnight)).toBe('Yesterday') // same UTC day, not the same Dhaka day
    expect(formatWhen('2026-11-24T18:01:00Z', 'en', justAfterMidnight)).toBe('12:01 am')
  })

  it.each([
    ['2026-11-25T13:42:00Z', '৭:৪২ PM'],
    ['2026-11-24T12:00:00Z', 'গতকাল'],
    ['2026-11-20T12:00:00Z', '২০ নভে'],
    ['2025-11-20T12:00:00Z', '২০ নভে, ২০২৫'],
  ])('bn: %s → %s (Bangla words and digits)', (iso, text) => {
    expect(formatWhen(iso, 'bn', new Date('2026-11-25T15:00:00Z'))).toBe(text) // 21:00 on the 25th in Dhaka
  })
})
