import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'ghost'

const base =
  'inline-flex min-h-12 items-center justify-center rounded-2xl px-5 text-base font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.98] disabled:opacity-60'

// Design V2.0: the main button is lit Maize with a glow under it; the other is a pane of glass.
const variants: Record<Variant, string> = {
  primary: 'glow-brand bg-linear-to-b from-[#ffd23f] to-brand text-brand-ink active:to-brand-strong',
  ghost: 'border border-edge bg-panel text-fg active:bg-line',
}

/** Shared so router links can look like buttons without nesting a button in a link. */
export function buttonClass(variant: Variant = 'primary', extra = '') {
  return `${base} ${variants[variant]} ${extra}`
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }

export function Button({ variant = 'primary', className = '', type = 'button', ...rest }: Props) {
  return <button type={type} className={buttonClass(variant, className)} {...rest} />
}
