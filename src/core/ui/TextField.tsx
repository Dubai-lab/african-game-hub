import { type InputHTMLAttributes, useId } from 'react'

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string
  error?: string
}

export function TextField({ label, hint, error, ...rest }: Props) {
  const id = useId()
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`mt-1 block min-h-12 w-full rounded-lg border bg-panel px-3 text-base text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 ${error ? 'border-danger' : 'border-line'}`}
        {...rest}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
