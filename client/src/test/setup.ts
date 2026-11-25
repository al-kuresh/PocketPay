import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import '../i18n'
import { useSession } from '../stores/session'
import { server } from './server'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  useSession.setState({ accessToken: null, user: null, status: 'loading' })
})
afterAll(() => server.close())
