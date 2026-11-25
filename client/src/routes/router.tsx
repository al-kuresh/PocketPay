import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { Login } from '../pages/auth/Login'
import { RequireActive, RequireAnonymous, RequireAuth, RequireRole } from './guards'
import { Home } from './home'
import { CashIn, CashOut, ChangePin, History, Payment, Profile, ReceiptPage, RegisterWizard, SendMoney } from './pages'

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
      // Any role and any status: history and receipts are read-only; Profile is every user's own.
      { path: 'history', element: <History /> },
      { path: 'transactions/:trxId', element: <ReceiptPage /> },
      { path: 'profile', element: <Profile /> },
      { path: 'profile/pin', element: <ChangePin /> },
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
        children: [{ element: <RequireActive />, children: [{ path: 'cash-in', element: <CashIn /> }] }],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]

export const router = createBrowserRouter(routes)
