// The tiles and the bag, drawn in code in the hub's own colours.
import { TILE_VALUES } from '../../../supabase/functions/_shared/words'

/** A letter tile: the letter, and what it scores. A blank shows its letter with no score. */
export function TileFace({ letter, blank = false, className = '', small = false }: { letter: string; blank?: boolean; className?: string; small?: boolean }) {
  const value = blank || letter === '?' ? 0 : (TILE_VALUES[letter.toLowerCase()] ?? 0)
  return (
    <span className={`relative flex aspect-square items-center justify-center rounded-[14%] border border-[#8a6a2a] bg-[#f6e3b4] font-extrabold uppercase leading-none text-[#22180a] shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)] ${blank ? 'text-[#8a5a1a]' : ''} ${className}`}>
      {letter === '?' ? '' : letter}
      {value > 0 && <span className={`absolute bottom-[4%] end-[8%] font-bold leading-none ${small ? 'text-[38%]' : 'text-[34%]'}`}>{value}</span>}
    </span>
  )
}

/** The back of a tile, as every player sees the tiles that are not theirs: the hub's indigo, with a gold-edged diamond. */
export function TileBack({ className = '' }: { className?: string }) {
  return (
    <span className={`relative flex aspect-square items-center justify-center rounded-[14%] border border-[#0b0f24] bg-[#1f2a7a] shadow-[inset_0_-2px_0_rgba(0,0,0,0.35)] ${className}`} data-tile-back>
      <span className="size-[44%] rotate-45 border border-[#f5b700] bg-[#d1264f]" />
    </span>
  )
}

/** The bag the tiles are drawn from: a drawstring pouch, with how many are left in it. */
export function Bag({ count, className = 'size-10' }: { count?: number; className?: string }) {
  return (
    <span className={`relative block shrink-0 ${className}`}>
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <path d="M12.500 13l-3-7.500c3.500 1.600 6.500 1.600 10.500 0 4 1.600 7 1.600 10.500 0l-3 7.500z" fill="#28348f" stroke="#0b0f24" strokeWidth="1.800" strokeLinejoin="round" />
        <path d="M12 13c-6 6-8.500 11.500-8.500 16.500A8.500 8.500 0 0 0 12 38h16a8.500 8.500 0 0 0 8.500-8.500C36.500 24.500 34 19 28 13z" fill="#1f2a7a" stroke="#0b0f24" strokeWidth="1.800" strokeLinejoin="round" />
        <rect x="10.500" y="11.500" width="19" height="3.400" rx="1.700" fill="#f5b700" stroke="#0b0f24" strokeWidth="1.200" />
        <path d="M27 14.500c3 2 4.500 4.500 4 7.500" fill="none" stroke="#f5b700" strokeWidth="1.600" strokeLinecap="round" />
      </svg>
      {count !== undefined && <span className="absolute inset-x-0 bottom-[12%] text-center text-[0.7rem] font-bold leading-none text-white">{count}</span>}
    </span>
  )
}
