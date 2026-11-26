import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import bn from '../../i18n/bn.json'
import en from '../../i18n/en.json'
import { useLanguage } from '../../stores/language'
import { useSession } from '../../stores/session'
import { setScreen } from '../../test/media'
import { renderPage } from '../../test/render'
import { server, testUser } from '../../test/server'

let pendingCount = 2

beforeEach(() => {
  pendingCount = 2
  useSession.getState().signIn({ user: testUser({ role: 'ADMIN', name: 'Demo Admin', phone: '01800000001' }), accessToken: 't' })
  server.use(
    http.get('/api/v1/admin/kyc', () => HttpResponse.json({ success: true, data: { items: [], nextCursor: null, pendingCount } })),
    http.get('/api/v1/admin/users', () => HttpResponse.json({ success: true, data: { items: [], nextCursor: null } })),
    http.get('/api/v1/admin/audit-logs', () => HttpResponse.json({ success: true, data: { items: [], nextCursor: null } })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  useLanguage.getState().setLang('en')
})

const menuItems = [en.admin.nav.kyc, en.admin.nav.users, en.admin.nav.audit]

describe('AdminLayout', () => {
  it('from lg: the sidebar with the three items, the admin, Log out; no menu button', async () => {
    setScreen('desktop')
    await renderPage('/admin/users')
    const nav = await screen.findByRole('navigation', { name: en.admin.nav.label })
    for (const name of menuItems) expect(within(nav).getByRole('link', { name: new RegExp(`^${name}`) })).toBeInTheDocument()
    expect(within(nav).getAllByRole('link')).toHaveLength(3) // nothing from Phase 7b
    expect(screen.getByText('Demo Admin')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.common.logout })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.admin.nav.menu })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: en.admin.nav.users })).toBeInTheDocument()
  })

  it('below lg: an app bar with the title and a menu button, no sidebar until the sheet opens', async () => {
    setScreen('phone')
    const { user } = await renderPage('/admin/audit')
    expect(await screen.findByRole('heading', { level: 1, name: en.admin.nav.audit })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: en.admin.nav.label })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: en.admin.nav.menu }))
    const sheet = screen.getByRole('dialog', { name: en.admin.nav.label })
    for (const name of menuItems) expect(within(sheet).getByRole('link', { name: new RegExp(`^${name}`) })).toBeInTheDocument()
  })

  it('the active item has aria-current="page"', async () => {
    setScreen('desktop')
    await renderPage('/admin/users')
    const nav = await screen.findByRole('navigation', { name: en.admin.nav.label })
    expect(within(nav).getByRole('link', { name: en.admin.nav.users })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: new RegExp(`^${en.admin.nav.kyc}`) })).not.toHaveAttribute('aria-current')
  })

  it('the badge shows pendingCount, named in the link', async () => {
    setScreen('desktop')
    await renderPage('/admin/users')
    const nav = await screen.findByRole('navigation', { name: en.admin.nav.label })
    expect(await within(nav).findByRole('link', { name: `${en.admin.nav.kyc}, 2 ${en.admin.nav.pending}` })).toBeInTheDocument()
  })

  it('no badge when nothing is pending', async () => {
    pendingCount = 0
    let asked = 0
    server.use(
      http.get('/api/v1/admin/kyc', () => {
        asked++
        return HttpResponse.json({ success: true, data: { items: [], nextCursor: null, pendingCount: 0 } })
      }),
    )
    setScreen('desktop')
    await renderPage('/admin/users')
    const nav = await screen.findByRole('navigation', { name: en.admin.nav.label })
    await waitFor(() => expect(asked).toBeGreaterThan(0))
    await waitFor(() => expect(within(nav).getByRole('link', { name: new RegExp(`^${en.admin.nav.kyc}`) }).textContent).toBe(en.admin.nav.kyc))
  })

  it('the badge count is in Bangla digits in bn', async () => {
    useLanguage.getState().setLang('bn')
    setScreen('desktop')
    await renderPage('/admin/users')
    const nav = await screen.findByRole('navigation', { name: bn.admin.nav.label })
    expect(await within(nav).findByRole('link', { name: `${bn.admin.nav.kyc}, ২ ${bn.admin.nav.pending}` })).toBeInTheDocument()
  })

  it('the sheet traps focus, closes on Esc, and focus returns to the menu button', async () => {
    setScreen('phone')
    const { user } = await renderPage('/admin/users')
    const menu = await screen.findByRole('button', { name: en.admin.nav.menu })
    await user.click(menu)
    const sheet = screen.getByRole('dialog', { name: en.admin.nav.label })
    expect(sheet).toHaveAttribute('aria-modal', 'true')
    expect(sheet.contains(document.activeElement)).toBe(true)
    // Tab all the way round, both ways: focus never leaves the sheet.
    for (let i = 0; i < 12; i++) {
      await user.tab()
      expect(sheet.contains(document.activeElement)).toBe(true)
    }
    for (let i = 0; i < 4; i++) {
      await user.tab({ shift: true })
      expect(sheet.contains(document.activeElement)).toBe(true)
    }
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(menu).toHaveFocus()
  })

  it('picking an item in the sheet goes there and closes the sheet', async () => {
    setScreen('phone')
    const { user, router } = await renderPage('/admin/users')
    await user.click(await screen.findByRole('button', { name: en.admin.nav.menu }))
    await user.click(within(screen.getByRole('dialog')).getByRole('link', { name: en.admin.nav.audit }))
    expect(router.state.location.pathname).toBe('/admin/audit')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('Log out ends the session and goes to /login', async () => {
    let logouts = 0
    server.use(
      http.post('/api/v1/auth/logout', () => {
        logouts++
        return new HttpResponse(null, { status: 204 })
      }),
    )
    setScreen('desktop')
    const { user, router } = await renderPage('/admin/users')
    await user.click(await screen.findByRole('button', { name: en.common.logout }))
    expect(await screen.findByRole('heading', { name: en.login.title })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(logouts).toBe(1)
  })
})
