import { useId, type InputHTMLAttributes, type Ref } from 'react'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  /** Already translated. */
  error?: string
  hint?: string
  ref?: Ref<HTMLInputElement>
}

export function Input({ label, error, hint, id, className = '', ref, ...rest }: InputProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const noteId = `${inputId}-note`
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm text-text">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? noteId : undefined}
        className={`h-12 rounded-xl border bg-surface px-4 text-base text-text disabled:bg-surface-sunken ${error ? 'border-danger' : 'border-border-strong'} ${className}`}
        {...rest}
      />
      {error ? (
        <p id={noteId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={noteId} className="text-sm text-text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  )
}
