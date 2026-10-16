// A picture for each game on the hub.
//
// The games' own pictures are illustrations made for African Game Hub (see ASSETS.md), served
// small from public/games/. Underneath each is a simpler picture drawn here in code: it is what
// shows when the illustration cannot be fetched (offline, a failed download) and for a game that
// has no illustration yet. A game with neither gets a plain token.
import { useState } from 'react'

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

/** Check Up: three cards in a fan, a circle, a star and a triangle. */
function CheckUp() {
  const card = (x: number, turn: number, mark: React.JSX.Element) => (
    <g transform={`rotate(${turn} 60 96)`}>
      <rect x={x} y="24" width="34" height="48" rx="4" fill="#fffdf6" stroke="#0b0f24" strokeWidth="2.5" />
      {mark}
    </g>
  )
  return (
    <>
      <rect width="120" height="100" fill="#1f2a7a" />
      <circle cx="60" cy="52" r="40" fill="#28348f" />
      {card(21, -16, <circle cx="38" cy="48" r="9" fill="#d1264f" />)}
      {card(43, 0, <polygon points="60,37 63.2,44.6 71.4,45.3 65.2,50.7 67.1,58.7 60,54.4 52.9,58.7 54.8,50.7 48.6,45.3 56.8,44.6" fill="#6b2fa0" />)}
      {card(65, 16, <path d="M82 39 L92 57 L72 57 Z" fill="#0b7a55" />)}
      <path d="M14 88 l6 -6 l6 6 l6 -6 l6 6 l6 -6 l6 6 l6 -6 l6 6 l6 -6 l6 6 l6 -6 l6 6 l6 -6 l6 6 l6 -6" fill="none" stroke="#f5b700" strokeWidth="3" />
    </>
  )
}

/** Word Battle: letter tiles crossing on a board, one on a bonus square. */
function Words() {
  const tile = (x: number, y: number, letter: string) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width="20" height="20" rx="3" fill="#f6e3b4" stroke="#0b0f24" strokeWidth="2" />
      <text x={x + 10} y={y + 15} textAnchor="middle" fontSize="13" fontWeight="800" fontFamily="system-ui, sans-serif" fill="#22180a">
        {letter}
      </text>
    </g>
  )
  return (
    <>
      <rect width="120" height="100" fill="#0b7a55" />
      <rect x="8" y="6" width="104" height="88" fill="#e9ecf7" stroke="#0b0f24" strokeWidth="2" />
      <rect x="10" y="8" width="20" height="20" fill="#d1264f" />
      <rect x="90" y="72" width="20" height="20" fill="#d1264f" />
      <rect x="90" y="8" width="20" height="20" fill="#3d55c4" />
      <rect x="10" y="72" width="20" height="20" fill="#f7d77a" />
      {tile(18, 40, 'W')}
      {tile(39, 40, 'O')}
      {tile(60, 40, 'R')}
      {tile(81, 40, 'D')}
      {tile(39, 19, 'G')}
      {tile(39, 61, 'T')}
    </>
  )
}

function Oware() {
  // Two rows of six pits in a wooden board, with seeds in them: a few more in one pit, being sown.
  const counts = [4, 4, 5, 3, 4, 2, 4, 6, 4, 3, 4, 4]
  const seeds = (cx: number, cy: number, count: number, key: string) =>
    Array.from({ length: count }, (_, k) => {
      const a = k * 2.4
      const r = Math.min(4.2, 1.6 * Math.sqrt(k + 0.5))
      return <ellipse key={`${key}-${k}`} cx={cx + r * Math.cos(a)} cy={cy + r * Math.sin(a)} rx="2" ry="1.6" fill={k % 2 === 0 ? '#c9c1b1' : '#9c8f7d'} stroke="#4f4335" strokeWidth="0.5" />
    })
  return (
    <>
      <rect width="120" height="100" fill="#1f2a7a" />
      <circle cx="60" cy="50" r="44" fill="#2c3a9e" />
      <rect x="8" y="28" width="104" height="44" rx="14" fill="#7a4320" stroke="#0b0f24" strokeWidth="2" />
      <rect x="11" y="30" width="98" height="3" rx="1.5" fill="#a5642e" />
      {counts.map((count, i) => {
        const cx = 18 + (i % 6) * 16.8
        const cy = i < 6 ? 41 : 60
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r="7.2" fill="#3a1c0b" />
            {seeds(cx, cy, count, String(i))}
          </g>
        )
      })}
      {/* A hand's worth of seeds, falling into the next pit. */}
      <g stroke="#4f4335" strokeWidth="0.5">
        <ellipse cx="88" cy="20" rx="2.4" ry="1.9" fill="#c9c1b1" />
        <ellipse cx="94" cy="15" rx="2.4" ry="1.9" fill="#9c8f7d" />
      </g>
      <path d="M84 24 q4 4 0 8" fill="none" stroke="#f6b800" strokeWidth="1.6" strokeLinecap="round" />
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

const ART: Record<string, () => React.JSX.Element> = { chess: Chess, ludo: Ludo, pool: Pool, draughts: Draughts, checkup: CheckUp, words: Words, oware: Oware, penalty: Penalty, penalty_shootout: Penalty }

/** Games that have an illustration in public/games/. (Made by `npm run game-art`.) */
const ILLUSTRATED = new Set(['chess', 'draughts', 'ludo', 'pool', 'penalty', 'penalty_shootout'])
const fileFor = (gameId: string) => (gameId === 'penalty_shootout' ? 'penalty' : gameId)

/** The picture for a game, by its id in the games registry. Decoration only: the name is written beside it. */
export function GameArt({ gameId, className = '' }: { gameId: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (ILLUSTRATED.has(gameId) && !failed) {
    return <img src={`/games/${fileFor(gameId)}.webp`} alt="" width={720} height={600} loading="lazy" decoding="async" onError={() => setFailed(true)} className={`object-cover ${className}`} />
  }
  const Picture = ART[gameId] ?? Token
  return (
    <svg viewBox="0 0 120 100" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden="true">
      <Picture />
    </svg>
  )
}
