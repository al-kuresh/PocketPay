import { setupServer } from 'msw/node'
import type { PublicUser } from '../api/types'

/** One MSW server for every test file; each test adds its own handlers with server.use(). */
export const server = setupServer()

/** The API's error envelope, for MSW handlers. */
export const apiError = (code: string, details?: unknown) => ({
  success: false,
  error: { code, message: `${code} (test)`, details },
})

export const testUser = (overrides: Partial<PublicUser> = {}): PublicUser => ({
  id: '6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
  phone: '01700000000',
  name: 'Test User',
  role: 'CUSTOMER',
  status: 'ACTIVE',
  shopName: null,
  nidMasked: '*******890',
  profilePhotoUrl: null,
  kycStatus: 'APPROVED',
  ...overrides,
})

export interface SentFile {
  name: string
  type: string
  size: number
}

/**
 * Read a multipart/form-data request body. Parsed by hand because MSW's request.formData() (Node's undici parser)
 * can't read the File objects jsdom's XHR sends, and throws.
 */
export async function readMultipart(request: Request) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/.exec(request.headers.get('content-type') ?? '')
  if (!match) throw new Error('not a multipart request')
  const boundary = `--${match[1] ?? match[2]}`
  const fields: Record<string, string> = {}
  const files: Record<string, SentFile> = {}
  const parts = (await request.text()).split(boundary).slice(1, -1) // drop the preamble and the closing "--"
  for (const part of parts) {
    const at = part.indexOf('\r\n\r\n')
    const head = part.slice(0, at)
    const body = part.slice(at + 4, -2) // without the CRLF before the next boundary
    const name = /; name="([^"]*)"/.exec(head)?.[1]
    if (!name) continue
    const filename = /; filename="([^"]*)"/.exec(head)?.[1]
    if (filename === undefined) fields[name] = body
    else
      files[name] = {
        name: filename,
        type: /content-type:\s*(\S+)/i.exec(head)?.[1] ?? '',
        size: new TextEncoder().encode(body).length,
      }
  }
  return { fields, files }
}
