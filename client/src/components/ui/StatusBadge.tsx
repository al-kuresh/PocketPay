// Status by meaning, always with its text label, never colour alone (TASTE.md, Admin panel).
const TONES = {
  warning: 'border-warning text-warning-dark',
  success: 'border-success text-success-dark',
  danger: 'border-danger text-danger',
  muted: 'border-border-strong text-text-muted',
}

const BY_STATUS: Record<string, keyof typeof TONES> = {
  PENDING: 'warning',
  PENDING_KYC: 'warning',
  ACTIVE: 'success',
  APPROVED: 'success',
  FROZEN: 'danger',
  REJECTED: 'danger',
}

/** A user or KYC status (`status` is the API value) with its translated `label`. */
export function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border bg-surface px-3 text-xs font-semibold ${TONES[BY_STATUS[status] ?? 'muted']}`}
    >
      {label}
    </span>
  )
}
