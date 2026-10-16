import { type InputHTMLAttributes, useId } from 'react'

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string
  error?: string
  /** Good news about what was typed ("this name is free"). Shown in place of the hint. */
  success?: string
}

export function TextField({ label, hint, error, success, ...rest }: Props) {
  const id = useId()
  const describedBy = error ? `${id}-error` : success || hint ? `${id}-hint` : undefined
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`mt-1 block min-h-12 w-full rounded-lg border bg-panel px-3 text-base text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 ${error ? 'border-danger' : 'border-line'}`}
        {...rest}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm font-semibold text-alert" role="alert">
          {error}
        </p>
      ) : success ? (
        <p id={`${id}-hint`} className="mt-1 text-sm font-semibold text-good" role="status">
          {success}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
