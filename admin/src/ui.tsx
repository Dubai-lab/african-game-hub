import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { ApiError } from './lib/api'

const numberFormat = new Intl.NumberFormat('en')
const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

export const tokens = (n: number | null | undefined) => numberFormat.format(n ?? 0)
export const signed = (n: number) => (n > 0 ? `+${numberFormat.format(n)}` : numberFormat.format(n))
/** Shown in the admin's own time zone; hover for the exact UTC instant. */
export function When({ at }: { at: string | null | undefined }) {
  if (!at) return <span className="text-muted">—</span>
  return <time dateTime={at} title={new Date(at).toISOString()}>{dateTime.format(new Date(at))}</time>
}
export const words = (code: string | null | undefined) => (code ? code.replace(/_/g, ' ') : '—')

type Variant = 'primary' | 'plain' | 'danger'
const variants: Record<Variant, string> = {
  primary: 'bg-indigo text-white hover:bg-indigo-soft',
  plain: 'border border-line bg-panel hover:border-indigo',
  danger: 'bg-danger text-white hover:brightness-110',
}

export function Button({ variant = 'plain', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-9 items-center justify-center rounded px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
    />
  )
}

export function PageTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <h1 className="text-2xl font-bold">{children}</h1>
      {aside}
    </div>
  )
}

export function Card({ title, children, className = '' }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded border border-line bg-panel ${className}`}>
      {title && <h2 className="border-b border-line px-4 py-2.5 text-sm font-bold">{title}</h2>}
      {children}
    </section>
  )
}

export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'danger' | 'ok' }) {
  return (
    <div className={`rounded border bg-panel px-4 py-3 ${tone === 'danger' ? 'border-danger' : 'border-line'}`}>
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone === 'danger' ? 'text-danger' : tone === 'ok' ? 'text-ok' : ''}`}>{value}</div>
      {note && <div className="mt-0.5 text-xs text-muted">{note}</div>}
    </div>
  )
}

const tones = {
  neutral: 'bg-ground text-ink',
  ok: 'bg-ok/10 text-ok',
  danger: 'bg-danger/10 text-danger',
  warn: 'bg-maize/25 text-ink',
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: keyof typeof tones }) {
  return <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>
}

/** A table that scrolls sideways inside its card on a narrow screen instead of breaking the page. */
export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} scope="col" className="whitespace-nowrap px-4 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:not(:last-child)]:border-b [&>tr]:border-line [&_td]:px-4 [&_td]:py-2">{children}</tbody>
      </table>
      {empty && <p className="px-4 py-6 text-center text-sm text-muted">Nothing here.</p>}
    </div>
  )
}

export function Loading() {
  return <div className="h-32 animate-pulse rounded border border-line bg-panel" role="status" aria-label="Loading" />
}

export function Failure({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div role="alert" className="rounded border border-danger bg-danger/5 px-4 py-3 text-sm">
      <p className="font-semibold text-danger">{error instanceof ApiError ? error.message : 'Could not load this. Nothing was changed.'}</p>
      {retry && (
        <Button className="mt-2" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function Pager({ total, limit, offset, onOffset }: { total: number; limit: number; offset: number; onOffset: (offset: number) => void }) {
  if (total <= limit) return null
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-sm">
      <span className="text-muted">
        {offset + 1}–{Math.min(offset + limit, total)} of {tokens(total)}
      </span>
      <div className="flex gap-2">
        <Button disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - limit))}>
          Previous
        </Button>
        <Button disabled={offset + limit >= total} onClick={() => onOffset(offset + limit)}>
          Next
        </Button>
      </div>
    </div>
  )
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`min-h-9 rounded px-3 text-sm font-semibold ${o.value === value ? 'bg-ink text-white' : 'border border-line bg-panel hover:border-indigo'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const inputClass = 'min-h-9 w-full rounded border border-line bg-panel px-2.5 text-sm'

/**
 * Every action that changes something goes through this: it says plainly what will happen,
 * asks for the reason that will be kept in the audit log, and shows the server's answer.
 */
export function ActionDialog({
  title,
  explain,
  confirmLabel,
  danger,
  reasonLabel = 'Reason (kept in the audit log)',
  reasonRequired = true,
  children,
  onConfirm,
  onClose,
}: {
  title: string
  explain: ReactNode
  confirmLabel: string
  danger?: boolean
  reasonLabel?: string
  reasonRequired?: boolean
  children?: ReactNode
  onConfirm: (reason: string) => Promise<void>
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // (Development runs effects twice; opening an open dialog is an error.)
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onConfirm(reason.trim())
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Nothing was changed.')
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby={`${id}-title`} className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded border border-line bg-panel p-0 backdrop:bg-ink/50">
      <form onSubmit={submit} className="p-5">
        <h2 id={`${id}-title`} className="text-lg font-bold">
          {title}
        </h2>
        <div className="mt-2 text-sm text-muted">{explain}</div>
        {children && <div className="mt-4 grid gap-3">{children}</div>}
        <label htmlFor={`${id}-reason`} className="mt-4 block text-sm font-semibold">
          {reasonLabel}
        </label>
        <textarea
          id={`${id}-reason`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required={reasonRequired}
          minLength={reasonRequired ? 5 : undefined}
          maxLength={500}
          rows={3}
          className={`${inputClass} mt-1 py-2`}
        />
        {error && (
          <p role="alert" className="mt-3 text-sm font-semibold text-danger">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => ref.current?.close()} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  )
}
