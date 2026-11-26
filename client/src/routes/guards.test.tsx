import { screen } from '@testing-library/react'
import { renderRoutes } from '../test/render'
import { describe, expect, it } from 'vitest'
import { useSession } from '../stores/session'
import { testUser } from '../test/server'
import type { PublicUser } from '../api/types'
import en from '../i18n/en.json'

const visit = (path: string) => renderRoutes(path).router

const signIn = (user: Partial<PublicUser>) =>
  useSession.getState().signIn({ user: testUser(user), accessToken: 't' })

describe('route guards', () => {
  it('anonymous at / → /login', async () => {
    useSession.getState().clear()
    const router = visit('/')
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('shows nothing protected while the session is still loading', () => {
    const router = visit('/')
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('an ACTIVE customer can open Send Money', async () => {
    signIn({ role: 'CUSTOMER', status: 'ACTIVE' })
    visit('/send-money')
    expect(await screen.findByRole('heading', { name: 'Send Money' })).toBeInTheDocument()
  })

  it('a CUSTOMER at an agent page → the customer home', async () => {
    signIn({ role: 'CUSTOMER', status: 'ACTIVE' })
    const router = visit('/cash-in')
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('an AGENT at a customer page → the agent home', async () => {
    signIn({ role: 'AGENT', status: 'ACTIVE' })
    const router = visit('/send-money')
    expect(await screen.findByRole('button', { name: 'Cash In' })).toBeInTheDocument() // the agent home's own action
    expect(router.state.location.pathname).toBe('/')
  })

  it('a PENDING_KYC customer typing /send-money → home', async () => {
    signIn({ role: 'CUSTOMER', status: 'PENDING_KYC', kycStatus: 'PENDING' })
    const router = visit('/send-money')
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('a REJECTED agent typing /cash-in → home', async () => {
    signIn({ role: 'AGENT', status: 'REJECTED', kycStatus: 'REJECTED' })
    const router = visit('/cash-in')
    expect(await screen.findByRole('button', { name: 'Cash In' })).toBeInTheDocument() // the agent home's own action
    expect(router.state.location.pathname).toBe('/')
  })

  it('a signed-in user who opens /login → their home', async () => {
    signIn({ role: 'AGENT', status: 'ACTIVE' })
    const router = visit('/login')
    expect(await screen.findByRole('button', { name: 'Cash In' })).toBeInTheDocument() // the agent home's own action
    expect(router.state.location.pathname).toBe('/')
  })

  it('a signed-in user who opens /register → their home', async () => {
    signIn({ role: 'CUSTOMER', status: 'ACTIVE' })
    const router = visit('/register')
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('an ADMIN at / → the KYC queue at /admin/kyc', async () => {
    signIn({ role: 'ADMIN' })
    const router = visit('/')
    expect(await screen.findByRole('heading', { level: 1, name: en.admin.nav.kyc })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/admin/kyc')
  })

  it('an ADMIN at a customer page → /admin/kyc', async () => {
    signIn({ role: 'ADMIN' })
    const router = visit('/send-money')
    expect(await screen.findByRole('heading', { level: 1, name: en.admin.nav.kyc })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/admin/kyc')
  })

  it('a CUSTOMER at /admin/users → the customer home', async () => {
    signIn({ role: 'CUSTOMER', status: 'ACTIVE' })
    const router = visit('/admin/users')
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('an AGENT at /admin/kyc/<id> → the agent home', async () => {
    signIn({ role: 'AGENT', status: 'ACTIVE' })
    const router = visit('/admin/kyc/0b6c2f9e-7a3d-4c1b-9e8f-1a2b3c4d5e6f')
    expect(await screen.findByRole('button', { name: 'Cash In' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('/login waits for the session restore (no flash of the form)', () => {
    visit('/login')
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('a code-split page shows the skeleton while its chunk loads, then the page', async () => {
    signIn({ role: 'CUSTOMER', status: 'ACTIVE' })
    visit('/profile/pin') // no other test in this file loads ChangePin, so its chunk is not cached yet
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Change PIN' })).toBeInTheDocument()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeInTheDocument()
  })
})
