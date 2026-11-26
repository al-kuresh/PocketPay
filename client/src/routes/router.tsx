import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { Login } from '../pages/auth/Login'
import { RequireActive, RequireAnonymous, RequireAuth, RequireRole } from './guards'
import { Home } from './home'
import {
  AdminLayout,
  AdminUsers,
  AuditLog,
  CashIn,
  CashOut,
  ChangePin,
  History,
  KycQueue,
  KycResubmit,
  KycReview,
  Payment,
  Profile,
  ReceiptPage,
  RegisterWizard,
  SendMoney,
  UserDetail,
} from './pages'

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
      // Any role; the page itself sends anyone but a REJECTED user home.
      { path: 'kyc/resubmit', element: <KycResubmit /> },
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
      {
        // Admins only; anyone else lands on their own home. `handle.title` is the page title in AdminLayout.
        path: 'admin',
        element: <RequireRole role="ADMIN" />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              { index: true, element: <Navigate to="kyc" replace /> },
              { path: 'kyc', handle: { title: 'admin.nav.kyc' }, element: <KycQueue /> },
              { path: 'kyc/:id', handle: { title: 'admin.nav.kyc' }, element: <KycReview /> },
              { path: 'users', handle: { title: 'admin.nav.users' }, element: <AdminUsers /> },
              { path: 'users/:id', handle: { title: 'admin.nav.users' }, element: <UserDetail /> },
              { path: 'audit', handle: { title: 'admin.nav.audit' }, element: <AuditLog /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]

export const router = createBrowserRouter(routes)
