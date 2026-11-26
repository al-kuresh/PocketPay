import { lazy } from 'react'

// Login and the homes are in the main chunk (the first screen anyone sees). The rest loads on first visit,
// behind the guards' Suspense skeleton, which keeps the main chunk under Vite's 500 kB warning.
export const RegisterWizard = lazy(() => import('../pages/auth/register/RegisterWizard').then((m) => ({ default: m.RegisterWizard })))
export const History = lazy(() => import('../pages/shared/History').then((m) => ({ default: m.History })))
export const ReceiptPage = lazy(() => import('../pages/shared/Receipt').then((m) => ({ default: m.ReceiptPage })))
export const Profile = lazy(() => import('../pages/shared/Profile').then((m) => ({ default: m.Profile })))
export const ChangePin = lazy(() => import('../pages/shared/ChangePin').then((m) => ({ default: m.ChangePin })))
export const SendMoney = lazy(() => import('../pages/customer/SendMoney').then((m) => ({ default: m.SendMoney })))
export const CashOut = lazy(() => import('../pages/customer/CashOut').then((m) => ({ default: m.CashOut })))
export const Payment = lazy(() => import('../pages/customer/Payment').then((m) => ({ default: m.Payment })))
export const KycResubmit = lazy(() => import('../pages/kyc/Resubmit').then((m) => ({ default: m.Resubmit })))
export const CashIn = lazy(() => import('../pages/agent/CashIn').then((m) => ({ default: m.CashIn })))

// The admin panel: the layout and every page are their own chunks (no admin code in a customer's download).
export const AdminLayout = lazy(() => import('../components/layout/AdminLayout').then((m) => ({ default: m.AdminLayout })))
export const KycQueue = lazy(() => import('../pages/admin/KycQueue').then((m) => ({ default: m.KycQueue })))
export const KycReview = lazy(() => import('../pages/admin/KycReview').then((m) => ({ default: m.KycReview })))
export const AdminUsers = lazy(() => import('../pages/admin/Users').then((m) => ({ default: m.Users })))
export const UserDetail = lazy(() => import('../pages/admin/UserDetail').then((m) => ({ default: m.UserDetail })))
export const AuditLog = lazy(() => import('../pages/admin/AuditLog').then((m) => ({ default: m.AuditLog })))
