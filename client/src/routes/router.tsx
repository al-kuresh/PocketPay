import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { RequireActive, RequireAuth, RequireRole } from './guards'
import { Home, Page } from './placeholders'

export const routes: RouteObject[] = [
  { path: '/login', element: <Page title="Log in" /> },
  {
    element: <RequireAuth />,
    children: [
      { index: true, element: <Home /> },
      {
        element: <RequireRole role="CUSTOMER" />,
        children: [
          {
            element: <RequireActive />,
            children: [
              { path: 'send-money', element: <Page title="Send Money" /> },
              { path: 'cash-out', element: <Page title="Cash Out" /> },
              { path: 'payment', element: <Page title="Payment" /> },
            ],
          },
        ],
      },
      {
        element: <RequireRole role="AGENT" />,
        children: [{ element: <RequireActive />, children: [{ path: 'cash-in', element: <Page title="Cash In" /> }] }],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]

export const router = createBrowserRouter(routes)
