import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../i18n/en.json'
import { setScreen } from '../../test/media'
import { ConfirmDialog, ReasonField } from './ConfirmDialog'
import { DataTable } from './DataTable'

afterEach(() => vi.unstubAllGlobals())

const rows = [
  { id: 'a', name: 'Jamal Uddin', phone: '01800000006' },
  { id: 'b', name: 'Nusrat Jahan', phone: '01800000007' },
]
const columns = [
  { header: 'Name', cell: (r: (typeof rows)[number]) => r.name },
  { header: 'Phone', cell: (r: (typeof rows)[number]) => r.phone },
]

describe('DataTable', () => {
  it('from lg: a table with a header row', () => {
    setScreen('desktop')
    render(<DataTable caption="People" rows={rows} rowKey={(r) => r.id} columns={columns} />)
    const table = screen.getByRole('table', { name: 'People' })
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Name', 'Phone'])
    expect(within(table).getAllByRole('row')).toHaveLength(3)
  })

  it('below lg: one card per row, the first column as its title and the rest as label and value', () => {
    setScreen('phone')
    render(<DataTable caption="People" rows={rows} rowKey={(r) => r.id} columns={columns} />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const cards = within(screen.getByRole('list', { name: 'People' })).getAllByRole('listitem')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByText('Jamal Uddin')).toBeInTheDocument()
    expect(within(cards[0]).getByText('Phone')).toBeInTheDocument()
    expect(within(cards[0]).getByText('01800000006')).toBeInTheDocument()
  })
})

/** A button that opens a ConfirmDialog with a reason, as the admin pages use it. */
function Harness({ onConfirm }: { onConfirm(reason: string): void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  return (
    <>
      <button onClick={() => setOpen(true)}>Freeze</button>
      {open && (
        <ConfirmDialog
          title="Freeze Jamal Uddin?"
          message="They are logged out."
          confirmLabel="Freeze"
          reason={reason}
          onReasonChange={setReason}
          onConfirm={() => onConfirm(reason)}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  )
}

describe('ConfirmDialog', () => {
  it('names the action, traps focus, closes on Esc, and focus returns to the opener', async () => {
    const user = userEvent.setup()
    render(<Harness onConfirm={() => {}} />)
    const opener = screen.getByRole('button', { name: 'Freeze' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Freeze Jamal Uddin?' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.contains(document.activeElement)).toBe(true)
    for (let i = 0; i < 10; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    for (let i = 0; i < 3; i++) {
      await user.tab({ shift: true })
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('Cancel closes it too', async () => {
    const user = userEvent.setup()
    render(<Harness onConfirm={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Freeze' }))
    await user.click(screen.getByRole('button', { name: en.common.cancel }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a reason: confirm stays disabled under 5 characters (after trimming), the counter counts', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(<Harness onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: 'Freeze' }))
    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Freeze' })
    const field = within(dialog).getByRole('textbox', { name: en.admin.reason.label })
    expect(field).toHaveAttribute('maxlength', '200')
    await user.type(field, '  abcd  ')
    expect(confirm).toBeDisabled()
    expect(within(dialog).getByText('8/200')).toBeInTheDocument()
    await user.clear(field)
    await user.type(field, 'Fraud report')
    expect(within(dialog).getByText('12/200')).toBeInTheDocument()
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith('Fraud report')
  })

  it('while busy: both buttons are disabled and Esc does nothing', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(<ConfirmDialog title="Approve Jamal Uddin?" confirmLabel="Approve" busy onConfirm={() => {}} onCancel={onCancel} />)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: en.common.cancel })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('ReasonField quick chips fill the reason', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ReasonField value="" onChange={onChange} quick={[{ label: 'Blurry photo', text: 'The NID photo is blurry.' }]} />)
    await user.click(screen.getByRole('button', { name: 'Blurry photo' }))
    expect(onChange).toHaveBeenCalledWith('The NID photo is blurry.')
  })
})
