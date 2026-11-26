import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import '../i18n'
import { useSession } from '../stores/session'
import { server } from './server'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
// jsdom has no object URLs; ImagePicker previews need one.
URL.createObjectURL = vi.fn(() => 'blob:preview')
URL.revokeObjectURL = vi.fn()
// jsdom has no pointer capture; HoldToSendButton captures the pointer on press.
Element.prototype.setPointerCapture = vi.fn()
// Testing Library moves fake timers only through a global `jest` (its asyncWrapper and waitFor check for one).
// Under vitest there is none, so with a faked setTimeout user-event would wait forever. Real timers: unused.
Object.assign(globalThis, { jest: { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) } })
afterEach(() => {
  cleanup()
  server.resetHandlers()
  useSession.setState({ accessToken: null, user: null, status: 'loading' })
})
afterAll(() => server.close())
