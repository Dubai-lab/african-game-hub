// The cards of Check Up, drawn here in code: the hub's own design, in its own colours. Nothing
// is an image file and nothing is taken from any printed pack. Each shape has its own colour as
// well as its own outline, so a card can be told at a glance and by players who do not see
// colour well.
import { isWhot, numberOf, SHAPES, type Card, type Shape, shapeOf } from '../../../supabase/functions/_shared/checkup'

export const SHAPE_COLOR: Record<Shape, string> = {
  c: '#d1264f', // circle: hibiscus
  t: '#0b7a55', // triangle: palm
  x: '#1f2a7a', // cross: indigo
  s: '#c98a00', // square: deep gold
  r: '#6b2fa0', // star: violet
}

/** One shape, drawn to fill a box of the given size around the given centre. */
export function ShapeMark({ shape, cx = 30, cy = 42, size = 26 }: { shape: Shape; cx?: number; cy?: number; size?: number }) {
  const fill = SHAPE_COLOR[shape]
  const r = size / 2
  if (shape === 'c') return <circle cx={cx} cy={cy} r={r} fill={fill} />
  if (shape === 's') return <rect x={cx - r} y={cy - r} width={size} height={size} fill={fill} />
  if (shape === 't') return <path d={`M${cx} ${cy - r} L${cx + r} ${cy + r} L${cx - r} ${cy + r} Z`} fill={fill} />
  if (shape === 'x') {
    const arm = size * 0.32
    return <path d={`M${cx - arm / 2} ${cy - r} h${arm} v${r - arm / 2} h${r - arm / 2} v${arm} h${-(r - arm / 2)} v${r - arm / 2} h${-arm} v${-(r - arm / 2)} h${-(r - arm / 2)} v${-arm} h${r - arm / 2} Z`} fill={fill} />
  }
  // A five-pointed star.
  const points = Array.from({ length: 10 }, (_, i) => {
    const angle = (Math.PI / 5) * i - Math.PI / 2
    const reach = i % 2 === 0 ? r * 1.08 : r * 0.45
    return `${(cx + Math.cos(angle) * reach).toFixed(2)},${(cy + Math.sin(angle) * reach).toFixed(2)}`
  })
  return <polygon points={points.join(' ')} fill={fill} />
}

/** The face of a card. Decoration: whoever shows it says what it is in words. */
export function CardFace({ card, className = '' }: { card: Card; className?: string }) {
  const number = numberOf(card)
  if (isWhot(card)) {
    // The card that goes on anything: all five shapes round the number.
    return (
      <svg viewBox="0 0 60 84" className={className} aria-hidden="true">
        <rect x="1.5" y="1.5" width="57" height="81" rx="6" fill="#1f2a7a" stroke="#0b0f24" strokeWidth="3" />
        {SHAPES.map((shape, i) => {
          const angle = ((Math.PI * 2) / 5) * i - Math.PI / 2
          return <g key={shape}><circle cx={30 + Math.cos(angle) * 19} cy={42 + Math.sin(angle) * 22} r="7.5" fill="#eef0fa" /><ShapeMark shape={shape} cx={30 + Math.cos(angle) * 19} cy={42 + Math.sin(angle) * 22} size={9} /></g>
        })}
        <text x="30" y="48" textAnchor="middle" fontSize="19" fontWeight="800" fill="#f5b700" fontFamily="system-ui, sans-serif">20</text>
      </svg>
    )
  }
  const shape = shapeOf(card)!
  const color = SHAPE_COLOR[shape]
  return (
    <svg viewBox="0 0 60 84" className={className} aria-hidden="true">
      <rect x="1.5" y="1.5" width="57" height="81" rx="6" fill="#fffdf6" stroke="#0b0f24" strokeWidth="3" />
      <text x="7" y="19" fontSize="15" fontWeight="800" fill={color} fontFamily="system-ui, sans-serif">{number}</text>
      <text x="53" y="78" textAnchor="end" fontSize="15" fontWeight="800" fill={color} fontFamily="system-ui, sans-serif">{number}</text>
      <ShapeMark shape={shape} />
    </svg>
  )
}

/** The back of a card: the hub's indigo with its zigzag band. */
export function CardBack({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 84" className={className} aria-hidden="true">
      <rect x="1.5" y="1.5" width="57" height="81" rx="6" fill="#1f2a7a" stroke="#0b0f24" strokeWidth="3" />
      <rect x="8" y="8" width="44" height="68" rx="3" fill="none" stroke="#f5b700" strokeWidth="1.5" />
      <path d="M8 36 l5.5 6 l5.5 -6 l5.5 6 l5.5 -6 l5.5 6 l5.5 -6 l5.5 6 l5.5 -6 v12 l-5.5 -6 l-5.5 6 l-5.5 -6 l-5.5 6 l-5.5 -6 l-5.5 6 l-5.5 -6 l-5.5 6 Z" fill="#f5b700" />
      <circle cx="30" cy="22" r="4" fill="#d1264f" />
      <circle cx="30" cy="62" r="4" fill="#0b7a55" />
    </svg>
  )
}
