import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { RequireActive, RequireAuth, RequireRole } from './guards'
import { Home, Page } from './placeholders'

export const routes: RouteObject[] = [
  { path: '/login', element: <Page titleKey="login.title" /> },
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
              { path: 'send-money', element: <Page titleKey="flows.SEND_MONEY.title" /> },
              { path: 'cash-out', element: <Page titleKey="flows.CASH_OUT.title" /> },
              { path: 'payment', element: <Page titleKey="flows.PAYMENT.title" /> },
            ],
          },
        ],
      },
      {
        element: <RequireRole role="AGENT" />,
        children: [{ element: <RequireActive />, children: [{ path: 'cash-in', element: <Page titleKey="flows.CASH_IN.title" /> }] }],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]

export const router = createBrowserRouter(routes)
