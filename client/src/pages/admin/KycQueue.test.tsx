import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../i18n/en.json'
import { useSession } from '../../stores/session'
import { adminUser, kycItem, SUBMISSION_ID } from '../../test/admin'
import { setScreen } from '../../test/media'
import { renderPage } from '../../test/render'
import { server } from '../../test/server'

const NUSRAT = kycItem({
  id: '3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a',
  user: { id: 'n', name: 'Nusrat Jahan', phone: '01800000007', role: 'CUSTOMER', shopName: null, nidMasked: '*******007' },
})

let queries: URLSearchParams[]

beforeEach(() => {
  queries = []
  useSession.getState().signIn({ user: adminUser(), accessToken: 't' })
  server.use(
    http.get('/api/v1/admin/kyc', ({ request }) => {
      const params = new URL(request.url).searchParams
      if (params.get('limit') !== '1') queries.push(params) // not the sidebar badge's count
      const data = params.get('cursor') === 'c1' ? { items: [NUSRAT], nextCursor: null } : { items: [kycItem()], nextCursor: 'c1' }
      return HttpResponse.json({ success: true, data: { ...data, pendingCount: 2 } })
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

describe('KYC queue', () => {
  it('from lg: a table of PENDING submissions with name, role, phone and masked NID, each linking to its review', async () => {
    setScreen('desktop')
    await renderPage('/admin/kyc')
    const table = await screen.findByRole('table')
    const row = within(table).getByRole('row', { name: /Jamal Uddin/ })
    expect(within(row).getByText(en.roles.AGENT)).toBeInTheDocument()
    expect(within(row).getByText('01800000006')).toBeInTheDocument()
    expect(within(row).getByText('*******006')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: 'Review Jamal Uddin' })).toHaveAttribute('href', `/admin/kyc/${SUBMISSION_ID}`)
    expect(queries[0].get('status')).toBe('PENDING')
  })

  it('below lg: the same rows as cards', async () => {
    setScreen('phone')
    await renderPage('/admin/kyc')
    expect(await screen.findByRole('link', { name: 'Review Jamal Uddin' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('listitem')).toHaveTextContent('*******006')
  })

  it('the status tabs ask for that status', async () => {
    const { user } = await renderPage('/admin/kyc')
    await screen.findByRole('link', { name: 'Review Jamal Uddin' })
    await user.click(screen.getByRole('radio', { name: en.kycStatus.APPROVED }))
    await waitFor(() => expect(queries.at(-1)?.get('status')).toBe('APPROVED'))
    await user.click(screen.getByRole('radio', { name: en.kycStatus.REJECTED }))
    await waitFor(() => expect(queries.at(-1)?.get('status')).toBe('REJECTED'))
  })

  it('Load more sends the cursor and adds the next page', async () => {
    const { user } = await renderPage('/admin/kyc')
    await user.click(await screen.findByRole('button', { name: en.common.loadMore }))
    expect(await screen.findByRole('link', { name: 'Review Nusrat Jahan' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review Jamal Uddin' })).toBeInTheDocument()
    expect(queries.map((q) => q.get('cursor'))).toEqual([null, 'c1'])
    expect(screen.queryByRole('button', { name: en.common.loadMore })).not.toBeInTheDocument()
  })

  it('an empty queue says so', async () => {
    server.use(http.get('/api/v1/admin/kyc', () => HttpResponse.json({ success: true, data: { items: [], nextCursor: null, pendingCount: 0 } })))
    await renderPage('/admin/kyc')
    expect(await screen.findByText(en.admin.kyc.empty)).toBeInTheDocument()
  })
})
