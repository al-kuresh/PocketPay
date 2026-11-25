import { QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { createQueryClient } from '../api/queryClient'
import { ToastProvider } from '../components/ui/Toast'
import { routes } from '../routes/router'

/** The whole app at `path`, with the same providers as App.tsx and a fresh query cache per test. */
export function renderRoutes(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const queryClient = createQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { router, queryClient, user: userEvent.setup() }
}

/** renderRoutes for a lazy (code-split) page: resolves once its chunk has loaded and the Suspense skeleton is gone. */
export async function renderPage(path: string) {
  const rendered = renderRoutes(path)
  await waitFor(() => {
    if (document.querySelector('[aria-busy="true"]')) throw new Error(`${path} is still loading`)
  })
  return rendered
}
