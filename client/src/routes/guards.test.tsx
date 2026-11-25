import { screen } from '@testing-library/react'
import { renderRoutes } from '../test/render'
import { describe, expect, it } from 'vitest'
import { useSession } from '../stores/session'
import { testUser } from '../test/server'
import type { PublicUser } from '../api/types'

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

  it('/login waits for the session restore (no flash of the form)', () => {
    visit('/login')
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})
