import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import bn from '../../i18n/bn.json'
import en from '../../i18n/en.json'
import { useLanguage } from '../../stores/language'
import { useSession } from '../../stores/session'
import { adminUser, auditItem, JAMAL_ID } from '../../test/admin'
import { setScreen } from '../../test/media'
import { renderPage } from '../../test/render'
import { server } from '../../test/server'

let queries: URLSearchParams[]

beforeEach(() => {
  queries = []
  useSession.getState().signIn({ user: adminUser(), accessToken: 't' })
  server.use(
    http.get('/api/v1/admin/audit-logs', ({ request }) => {
      const params = new URL(request.url).searchParams
      queries.push(params)
      const data =
        params.get('cursor') === 'c1'
          ? { items: [auditItem({ id: 'b', action: 'LOGIN_SUCCESS', actor: null, metadata: null })], nextCursor: null }
          : { items: [auditItem()], nextCursor: 'c1' }
      return HttpResponse.json({ success: true, data })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  useLanguage.getState().setLang('en')
})

/** The rows below lg (the cards list): the action <select> has the same labels, so never look in the whole page. */
const rows = (name = en.admin.nav.audit) => screen.findByRole('list', { name })

describe('Audit log', () => {
  it('a row: the Dhaka time, the actor, the translated action, the target and the metadata as key-value text', async () => {
    setScreen('desktop')
    await renderPage('/admin/audit')
    const row = within(await screen.findByRole('table')).getByRole('row', { name: /Account frozen/ })
    expect(within(row).getByText('26 Nov 2026, 11:00 am')).toBeInTheDocument() // 05:00Z is 11:00 in Dhaka
    expect(within(row).getByText('Demo Admin')).toBeInTheDocument()
    expect(within(row).getByText(en.admin.audit.actions.USER_FROZEN)).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: /2b0d6c1e/ })).toHaveAttribute('href', `/admin/users/${JAMAL_ID}`)
    expect(within(row).getByText('reason')).toBeInTheDocument()
    expect(within(row).getByText('Suspicious activity reported')).toBeInTheDocument()
    expect(within(row).getByText('127.0.0.1')).toBeInTheDocument()
  })

  it('in bn: the action label in Bangla', async () => {
    useLanguage.getState().setLang('bn')
    await renderPage('/admin/audit')
    expect(within(await rows(bn.admin.nav.audit)).getByText(bn.admin.audit.actions.USER_FROZEN)).toBeInTheDocument()
  })

  it('no actor reads "System"; an unknown action shows its code', async () => {
    server.use(
      http.get('/api/v1/admin/audit-logs', () =>
        HttpResponse.json({ success: true, data: { items: [auditItem({ action: 'SOMETHING_NEW', actor: null })], nextCursor: null } }),
      ),
    )
    await renderPage('/admin/audit')
    const list = await rows()
    expect(within(list).getByText(en.common.system)).toBeInTheDocument()
    expect(within(list).getByText('SOMETHING_NEW')).toBeInTheDocument()
  })

  it('the action filter and the Dhaka date range go in the query', async () => {
    const { user } = await renderPage('/admin/audit')
    await rows()
    await user.selectOptions(screen.getByRole('combobox', { name: en.admin.audit.action }), 'KYC_REJECTED')
    await waitFor(() => expect(queries.at(-1)?.get('action')).toBe('KYC_REJECTED'))
    fireEvent.change(screen.getByLabelText(en.history.from), { target: { value: '2026-11-20' } })
    fireEvent.change(screen.getByLabelText(en.history.to), { target: { value: '2026-11-26' } })
    // Each change is its own request and they can land in any order: look for the one with all three.
    await waitFor(() =>
      expect(queries.some((q) => q.get('action') === 'KYC_REJECTED' && q.get('from') === '2026-11-20' && q.get('to') === '2026-11-26')).toBe(true),
    )
  })

  it('Load more sends the cursor', async () => {
    const { user } = await renderPage('/admin/audit')
    await user.click(await screen.findByRole('button', { name: en.common.loadMore }))
    await waitFor(async () => expect(within(await rows()).getByText(en.admin.audit.actions.LOGIN_SUCCESS)).toBeInTheDocument())
    expect(queries.map((q) => q.get('cursor'))).toEqual([null, 'c1'])
  })

  it('below lg: cards, no table', async () => {
    setScreen('phone')
    await renderPage('/admin/audit')
    expect(within(await rows()).getByText(en.admin.audit.actions.USER_FROZEN)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
