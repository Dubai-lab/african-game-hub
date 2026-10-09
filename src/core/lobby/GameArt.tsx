// A picture for each game on the hub, drawn here in code (no image files, nothing borrowed).
// A game without a picture of its own gets a plain token.

const BALL = [
  ['#f6c400', 60, 34],
  ['#1c4ed8', 49, 53],
  ['#de1c2c', 71, 53],
  ['#682ea0', 38, 72],
  ['#16161a', 60, 72],
  ['#109454', 82, 72],
] as const

function Chess() {
  return (
    <>
      <rect width="120" height="100" fill="#1f2a7a" />
      {[0, 1, 2, 3, 4, 5].flatMap((col) => [0, 1, 2, 3, 4].map((row) => ((col + row) % 2 === 0 ? <rect key={`${col}-${row}`} x={col * 20} y={row * 20} width="20" height="20" fill="#2c3a9e" /> : null)))}
      {/* A king, and a pawn beside it. */}
      <g fill="#f4efe2" stroke="#0b0f24" strokeWidth="2" strokeLinejoin="round">
        <path d="M50 16h6v6h6v6h-6v6h-6v-6h-6v-6h6z" />
        <path d="M38 40c0-6 30-6 30 0c0 10-6 14-6 26h-18c0-12-6-16-6-26z" />
        <path d="M32 66h42l4 14H28z" />
      </g>
      <g fill="#f6b800" stroke="#0b0f24" strokeWidth="2" strokeLinejoin="round">
        <circle cx="92" cy="48" r="8" />
        <path d="M86 56h12c0 6-3 8-3 14h-6c0-6-3-8-3-14z" />
        <path d="M80 70h24l3 10H77z" />
      </g>
    </>
  )
}

function Ludo() {
  return (
    <>
      <rect width="120" height="100" fill="#f4efe2" />
      <rect x="6" y="6" width="42" height="36" fill="#de1c2c" />
      <rect x="72" y="6" width="42" height="36" fill="#109454" />
      <rect x="6" y="58" width="42" height="36" fill="#1c4ed8" />
      <rect x="72" y="58" width="42" height="36" fill="#f6b800" />
      {[[27, 24], [93, 24], [27, 76], [93, 76]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="9" fill="#f4efe2" stroke="#0b0f24" strokeWidth="2" />
      ))}
      {/* Two dice in the middle. */}
      <g stroke="#0b0f24" strokeWidth="2">
        <rect x="44" y="38" width="16" height="16" rx="3" fill="#d6283b" transform="rotate(-10 52 46)" />
        <rect x="60" y="46" width="16" height="16" rx="3" fill="#d6283b" transform="rotate(12 68 54)" />
      </g>
      <g fill="#fff">
        <circle cx="52" cy="46" r="2" />
        <circle cx="64" cy="50" r="1.7" />
        <circle cx="72" cy="58" r="1.7" />
      </g>
    </>
  )
}

function Pool() {
  return (
    <>
      <rect width="120" height="100" fill="#6b3b17" />
      <rect x="8" y="8" width="104" height="84" rx="4" fill="#1b8757" />
      {[[10, 10], [60, 8], [110, 10], [10, 90], [60, 92], [110, 90]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="6" fill="#0b0b0d" />
      ))}
      {BALL.map(([color, x, y]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r="10" fill={color} stroke="#0b0f24" strokeWidth="1.5" />
          <circle cx={x - 3} cy={y - 3} r="3" fill="#ffffff" opacity="0.55" />
        </g>
      ))}
    </>
  )
}

function Draughts() {
  return (
    <>
      <rect width="120" height="100" fill="#3a2a1c" />
      {[0, 1, 2, 3, 4, 5].flatMap((col) => [0, 1, 2, 3, 4].map((row) => ((col + row) % 2 === 0 ? <rect key={`${col}-${row}`} x={col * 20} y={row * 20} width="20" height="20" fill="#e9cf9c" /> : null)))}
      {[[30, 30, '#d6283b'], [70, 30, '#d6283b'], [50, 70, '#16161a'], [90, 70, '#16161a']].map(([x, y, color]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={Number(y) + 2} r="9" fill="#0b0f24" />
          <circle cx={x} cy={y} r="9" fill={String(color)} stroke="#f4efe2" strokeWidth="1.5" />
        </g>
      ))}
    </>
  )
}

function Penalty() {
  return (
    <>
      <rect width="120" height="100" fill="#109454" />
      <rect y="62" width="120" height="38" fill="#0c7a45" />
      <path d="M22 62V20h76v42" fill="none" stroke="#f4efe2" strokeWidth="5" strokeLinejoin="round" />
      {[34, 46, 58, 70, 82].map((x) => (
        <path key={x} d={`M${x} 22v40`} stroke="#f4efe2" strokeWidth="1" opacity="0.5" />
      ))}
      {[32, 42, 52].map((y) => (
        <path key={y} d={`M24 ${y}h72`} stroke="#f4efe2" strokeWidth="1" opacity="0.5" />
      ))}
      <circle cx="60" cy="80" r="11" fill="#f4efe2" stroke="#0b0f24" strokeWidth="2" />
      <path d="M60 74l5 4-2 6h-6l-2-6z" fill="#0b0f24" />
    </>
  )
}

function Token() {
  return (
    <>
      <rect width="120" height="100" fill="#1f2a7a" />
      <circle cx="60" cy="50" r="26" fill="#f6b800" stroke="#0b0f24" strokeWidth="3" />
      <circle cx="60" cy="50" r="16" fill="none" stroke="#0b0f24" strokeWidth="3" />
    </>
  )
}

const ART: Record<string, () => React.JSX.Element> = { chess: Chess, ludo: Ludo, pool: Pool, draughts: Draughts, penalty: Penalty, penalty_shootout: Penalty }

/** The picture for a game, by its id in the games registry. Decoration only: the name is written beside it. */
export function GameArt({ gameId, className = '' }: { gameId: string; className?: string }) {
  const Picture = ART[gameId] ?? Token
  return (
    <svg viewBox="0 0 120 100" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden="true">
      <Picture />
    </svg>
  )
}
