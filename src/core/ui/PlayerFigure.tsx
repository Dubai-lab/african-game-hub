// The little figure shown at a player's place at a table: a man, a woman, or (for a player who
// has not said, and for nobody in particular) a plain figure. The computer has one of its own.
// Drawn in code, in the hub's colours. Decoration: the player's name is always written beside
// it, so it is hidden from screen readers.

export type Gender = 'male' | 'female'
export type FigureKind = Gender | 'computer' | null | undefined

const SKIN = '#8a5a3c'
const SKIN_SHADE = '#6f4630'
const HAIR = '#16110d'
const INK = '#0b0f24'

/** One colour of clothing per seat: the hub's gold, hibiscus, palm and violet. */
export const SEAT_COLOURS = ['#f5b700', '#d1264f', '#0b7a55', '#6b2fa0']

type Props = {
  kind: FigureKind
  /** The player's place at the table (0 for the first seat): the colour they wear. */
  seatIndex?: number
  /** Size: for example "size-8". */
  className?: string
}

export function PlayerFigure({ kind, seatIndex = 0, className = 'size-8' }: Props) {
  const wear = SEAT_COLOURS[seatIndex % SEAT_COLOURS.length]!
  return (
    <svg viewBox="0 0 40 40" className={`shrink-0 ${className}`} aria-hidden="true" data-figure={kind ?? 'plain'}>
      <rect width="40" height="40" rx="8" fill="#e9ecf7" stroke={INK} strokeWidth="2" />
      {kind === 'computer' ? (
        <>
          <path d="M20 5v5" stroke={INK} strokeWidth="2" />
          <circle cx="20" cy="5" r="2.2" fill={wear} stroke={INK} strokeWidth="1.2" />
          <rect x="8" y="10" width="24" height="18" rx="4" fill="#c9cfe6" stroke={INK} strokeWidth="2" />
          <circle cx="15" cy="18" r="3" fill={INK} />
          <circle cx="25" cy="18" r="3" fill={INK} />
          <path d="M14 24h12" stroke={INK} strokeWidth="2" strokeLinecap="round" />
          <path d="M9 39v-3a6 6 0 0 1 6-6h10a6 6 0 0 1 6 6v3z" fill={wear} stroke={INK} strokeWidth="2" />
        </>
      ) : (
        <>
          {/* Shoulders, in the colour of the seat. */}
          <path d="M6 39v-2a9 9 0 0 1 9-9h10a9 9 0 0 1 9 9v2z" fill={wear} stroke={INK} strokeWidth="2" />
          {kind === 'female' && (
            // Hair worn out, behind the face, and a wrap tied over it in the seat's colour.
            <path d="M8 20a12 12 0 0 1 24 0v6a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z" fill={HAIR} />
          )}
          <rect x="17" y="24" width="6" height="6" fill={SKIN_SHADE} />
          <circle cx="20" cy="18" r="8.5" fill={SKIN} stroke={SKIN_SHADE} strokeWidth="1.2" />
          {kind === 'male' && (
            // Hair cut short, squared off at the top.
            <path d="M11.5 17v-4.5a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3V17c-2-2.6-4.6-3.8-8.5-3.8S13.500 14.400 11.500 17z" fill={HAIR} />
          )}
          {kind === 'female' && (
            <>
              <path d="M10.5 15.500c1-5 5-7.500 9.500-7.500s8.500 2.500 9.500 7.500c-3-2.300-6-3.200-9.500-3.200s-6.500.9-9.500 3.200z" fill={wear} stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
              <circle cx="29.500" cy="9.500" r="2.600" fill={wear} stroke={INK} strokeWidth="1.2" />
              <circle cx="11.300" cy="22" r="1.300" fill="#f5b700" />
              <circle cx="28.700" cy="22" r="1.300" fill="#f5b700" />
            </>
          )}
          {!kind && <path d="M11.5 16a8.500 8.500 0 0 1 17 0c-2.500-1.800-5.200-2.600-8.500-2.600S14 14.200 11.500 16z" fill={HAIR} />}
          <circle cx="17" cy="18.500" r="1.100" fill={INK} />
          <circle cx="23" cy="18.500" r="1.100" fill={INK} />
          <path d="M17 22.300c2 1.500 4 1.500 6 0" fill="none" stroke={INK} strokeWidth="1.200" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}
