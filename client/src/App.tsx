import { useEffect, useState } from 'react'
import { MobileShell } from './components/layout/MobileShell'

type ApiStatus = 'loading' | 'ok' | 'offline'

function App() {
  const [status, setStatus] = useState<ApiStatus>('loading')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/v1/health', { signal: controller.signal })
      .then((res) => res.json())
      .then((body) => setStatus(body?.data?.status === 'ok' ? 'ok' : 'offline'))
      .catch((err) => {
        // Aborted on unmount (or StrictMode's dev double-run): not an outage, so don't show 'offline'.
        if (err instanceof DOMException && err.name === 'AbortError') return
        setStatus('offline')
      })
    return () => controller.abort()
  }, [])

  return (
    <MobileShell>
      <header className="bg-primary px-6 py-8">
        <h1 className="text-3xl font-semibold text-white">PocketPay</h1>
      </header>

      <main className="flex flex-1 flex-col gap-6 p-6">
        <section className="rounded-2xl border border-border bg-surface p-6">
          <p className="text-sm text-text-muted">API status</p>
          <p
            aria-live="polite"
            className={`mt-1 text-lg font-semibold ${
              status === 'ok' ? 'text-success-dark' : status === 'offline' ? 'text-danger' : 'text-text-muted'
            }`}
          >
            {status === 'loading' ? 'API status: checking…' : `API status: ${status}`}
          </p>
        </section>

        <button
          type="button"
          className="mt-auto w-full rounded-xl bg-primary-dark py-3 font-semibold text-white hover:bg-primary-darker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-dark"
        >
          Get started
        </button>
      </main>
    </MobileShell>
  )
}

export default App
