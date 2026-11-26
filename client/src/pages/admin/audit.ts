import type { TFunction } from 'i18next'
import en from '../../i18n/en.json'

/** Every action the server writes (the translation file is the list). */
export const AUDIT_ACTIONS = Object.keys(en.admin.audit.actions)

/** An action's translated label; one the client doesn't know yet shows its code. */
export const auditLabel = (t: TFunction, action: string) => t(`admin.audit.actions.${action}`, { defaultValue: action })
