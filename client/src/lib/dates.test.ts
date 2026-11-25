import { describe, expect, it } from 'vitest'
import { formatDateTime } from './dates'

describe('formatDateTime (always Asia/Dhaka)', () => {
  it('en', () => {
    expect(formatDateTime('2026-11-24T18:30:00Z', 'en')).toBe('25 Nov 2026, 12:30 am')
  })

  it('bn: the same moment with Bangla digits', () => {
    expect(formatDateTime('2026-11-24T18:30:00Z', 'bn')).toBe('২৫ নভে, ২০২৬, ১২:৩০ AM')
  })
})
