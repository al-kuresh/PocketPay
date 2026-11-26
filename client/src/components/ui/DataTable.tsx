import type { ReactNode } from 'react'
import { useIsDesktop } from '../../lib/media'

export interface Column<T> {
  /** Already translated. */
  header: string
  cell(row: T): ReactNode
  /** Money: right-aligned. */
  align?: 'end'
  /** Long unbroken text (ids, metadata) may break anywhere instead of widening the table. */
  wrap?: boolean
}

interface DataTableProps<T> {
  /** Already translated: the table's (or list's) accessible name. */
  caption: string
  rows: T[]
  rowKey(row: T): string
  columns: Array<Column<T>>
}

/**
 * The admin lists (TASTE.md, Admin panel): from lg a table with a sticky header; below lg one card per row, the
 * first column as the card's title and the others as label: value lines.
 */
export function DataTable<T>({ caption, rows, rowKey, columns }: DataTableProps<T>) {
  const desktop = useIsDesktop()
  if (desktop) {
    return (
      <div className="rounded-3xl border border-border bg-surface">
        {/* border-separate: a sticky th keeps its own background; collapsed borders would scroll away from it. */}
        <table className="w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.header}
                  scope="col"
                  className={`sticky top-0 bg-surface px-4 py-3 text-xs font-medium text-text-muted first:rounded-tl-3xl last:rounded-tr-3xl ${c.align === 'end' ? 'text-right' : 'text-left'}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((c) => (
                  <td
                    key={c.header}
                    className={`border-t border-border px-4 py-3 align-middle text-text ${c.align === 'end' ? 'text-right' : ''} ${c.wrap ? 'wrap-anywhere' : ''}`}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  const [first, ...rest] = columns
  return (
    <ul aria-label={caption} className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={rowKey(row)} className="flex flex-col gap-2 rounded-3xl border border-border bg-surface p-4">
          <div className="text-base font-semibold text-text">{first.cell(row)}</div>
          <dl className="flex flex-col gap-1 text-sm">
            {rest.map((c) => (
              <div key={c.header} className="flex justify-between gap-3">
                <dt className="shrink-0 text-text-muted">{c.header}</dt>
                <dd className="min-w-0 text-right text-text wrap-anywhere">{c.cell(row)}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  )
}
