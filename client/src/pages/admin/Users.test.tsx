import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../i18n/en.json'
import { useSession } from '../../stores/session'
import { adminUser, JAMAL_ID, userRow } from '../../test/admin'
import { setScreen } from '../../test/media'
import { renderPage } from '../../test/render'
import { server } from '../../test/server'

const NUSRAT = userRow({ id: '3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a', name: 'Nusrat Jahan', phone: '01800000007', role: 'CUSTOMER', status: 'REJECTED', shopName: null, nidMasked: '*******007', kycStatus: 'REJECTED' })

let queries: URLSearchParams[]

beforeEach(() => {
  queries = []
  useSession.getState().signIn({ user: adminUser(), accessToken: 't' })
  server.use(
    http.get('/api/v1/admin/users', ({ request }) => {
      const params = new URL(request.url).searchParams
      queries.push(params)
      const data = params.get('cursor') === 'c1' ? { items: [NUSRAT], nextCursor: null } : { items: [userRow()], nextCursor: 'c1' }
      return HttpResponse.json({ success: true, data })
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

describe('Users', () => {
  it('search sends q once, 300 ms after the last keystroke', async () => {
    const { user } = await renderPage('/admin/users')
    await screen.findByRole('link', { name: 'Open Jamal Uddin' })
    await user.type(screen.getByRole('searchbox', { name: en.admin.users.search }), 'Jam')
    expect(queries.filter((q) => q.has('q'))).toHaveLength(0) // not per keystroke
    await waitFor(() => expect(queries.filter((q) => q.has('q'))).toHaveLength(1))
    expect(queries.at(-1)?.get('q')).toBe('Jam')
    await new Promise((r) => setTimeout(r, 400))
    expect(queries.filter((q) => q.has('q'))).toHaveLength(1)
  })

  it('the role and status chips filter', async () => {
    const { user } = await renderPage('/admin/users')
    await screen.findByRole('link', { name: 'Open Jamal Uddin' })
    await user.click(screen.getByRole('radio', { name: en.roles.AGENT }))
    await waitFor(() => expect(queries.at(-1)?.get('role')).toBe('AGENT'))
    await user.click(screen.getByRole('radio', { name: en.status.FROZEN }))
    await waitFor(() => expect(queries.at(-1)?.get('status')).toBe('FROZEN'))
    expect(queries.at(-1)?.get('role')).toBe('AGENT')
  })

  it('from lg: a table with the status as a text badge, linking to the user', async () => {
    setScreen('desktop')
    await renderPage('/admin/users')
    const row = within(await screen.findByRole('table')).getByRole('row', { name: /Jamal Uddin/ })
    expect(within(row).getByText(en.status.ACTIVE)).toBeInTheDocument()
    expect(within(row).getByText('*******006')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: 'Open Jamal Uddin' })).toHaveAttribute('href', `/admin/users/${JAMAL_ID}`)
  })

  it('below lg: cards, no table', async () => {
    setScreen('phone')
    await renderPage('/admin/users')
    await screen.findByRole('link', { name: 'Open Jamal Uddin' })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('Load more sends the cursor', async () => {
    const { user } = await renderPage('/admin/users')
    await user.click(await screen.findByRole('button', { name: en.common.loadMore }))
    expect(await screen.findByRole('link', { name: 'Open Nusrat Jahan' })).toBeInTheDocument()
    expect(queries.map((q) => q.get('cursor'))).toEqual([null, 'c1'])
  })

  it('nothing found says so', async () => {
    server.use(http.get('/api/v1/admin/users', () => HttpResponse.json({ success: true, data: { items: [], nextCursor: null } })))
    await renderPage('/admin/users')
    expect(await screen.findByText(en.admin.users.empty)).toBeInTheDocument()
  })
})
