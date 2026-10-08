import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'ghost'

const base =
  'inline-flex min-h-12 items-center justify-center rounded-md px-5 text-base font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60'

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink active:bg-brand-strong',
  ghost: 'border border-line bg-transparent text-ink active:bg-line/50',
}

/** Shared so router links can look like buttons without nesting a button in a link. */
export function buttonClass(variant: Variant = 'primary', extra = '') {
  return `${base} ${variants[variant]} ${extra}`
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }

export function Button({ variant = 'primary', className = '', type = 'button', ...rest }: Props) {
  return <button type={type} className={buttonClass(variant, className)} {...rest} />
}
