import { Input, type InputProps } from './Input'

/** A BD mobile number (01XXXXXXXXX). Bangla digits are fine: the schema converts them before checking. */
export function PhoneInput(props: Omit<InputProps, 'type'>) {
  return <Input type="tel" inputMode="tel" autoComplete="tel-national" maxLength={11} className="tabular-nums" {...props} />
}
