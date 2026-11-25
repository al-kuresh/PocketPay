import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { Login } from '../pages/auth/Login'
import { RegisterWizard } from '../pages/auth/register/RegisterWizard'
import { CashOut } from '../pages/customer/CashOut'
import { Payment } from '../pages/customer/Payment'
import { SendMoney } from '../pages/customer/SendMoney'
import { RequireActive, RequireAnonymous, RequireAuth, RequireRole } from './guards'
import { Home, Page } from './placeholders'

export const routes: RouteObject[] = [
  {
    element: <RequireAnonymous />,
    children: [
      { path: '/login', element: <Login /> },
      { path: '/register', element: <RegisterWizard /> },
    ],
  },
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
              { path: 'send-money', element: <SendMoney /> },
              { path: 'cash-out', element: <CashOut /> },
              { path: 'payment', element: <Payment /> },
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
