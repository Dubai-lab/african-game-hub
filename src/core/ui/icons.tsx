// The hub's own line icons, drawn for the tabs (design V2.0). One stroke weight, round ends,
// in the colour of the text around them. Original drawings: no icon set is copied.
import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: Props) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      {children}
    </svg>
  )
}

/** A gear's outline: eight teeth round a ring, worked out once. */
const GEAR = (() => {
  const points: string[] = []
  const teeth = 8
  for (let i = 0; i < teeth * 4; i++) {
    const angle = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / 2
    const radius = i % 4 === 0 || i % 4 === 1 ? 9.2 : 7
    points.push(`${(12 + radius * Math.cos(angle)).toFixed(2)},${(12 + radius * Math.sin(angle)).toFixed(2)}`)
  }
  return `M${points.join('L')}Z`
})()

export const TAB_ICONS = {
  lobby: (props: Props) => (
    <Icon {...props}>
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
    </Icon>
  ),
  wallet: (props: Props) => (
    <Icon {...props}>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a1 1 0 0 1 1 1v2" />
      <rect x="3.5" y="8" width="17" height="11" rx="2.5" />
      <path d="M16.5 13.5h.01" strokeWidth={2.6} />
    </Icon>
  ),
  leaderboards: (props: Props) => (
    <Icon {...props}>
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" />
      <path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4" />
      <path d="M12 13v3.5M8.5 20h7M9.5 20c0-2 1-3.5 2.5-3.5s2.5 1.5 2.5 3.5" />
    </Icon>
  ),
  friends: (props: Props) => (
    <Icon {...props}>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
      <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.4 14.8c1.7.6 2.8 2.2 3.1 4.7" />
    </Icon>
  ),
  profile: (props: Props) => (
    <Icon {...props}>
      <circle cx="12" cy="8.5" r="3.7" />
      <path d="M4.8 20c.8-3.8 3.6-6 7.2-6s6.4 2.2 7.2 6" />
    </Icon>
  ),
  settings: (props: Props) => (
    <Icon {...props}>
      <path d={GEAR} />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  ),
} as const
