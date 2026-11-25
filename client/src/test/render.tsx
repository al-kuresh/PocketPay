import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
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
