import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { flagEmoji } from '@/core/countries/useCountries'
import { Button } from '@/core/ui/Button'
import { ChatFold, GameBar, GameHeader, GameMenu, useChatFold, useLockedScreen } from '@/core/ui/gameScreen'
import { feedback, preloadSounds } from '@/games/checkup/sound'
import { type Bonus, bonusAt, cell, evaluate, type Laid, RACK_SIZE, type Seat, SIZE, type Tile, TILE_VALUES } from '../../../supabase/functions/_shared/words'
import type { TableView } from './useWordsGame'

// The Word Battle screen: the players and their scores across the top, the board in the
// middle, the player's own rack and what to do with it underneath. Shows a table; decides
// nothing. The same screen serves an online game (the server's table) and practice against
// the computer.
//
// Laying a word: touch a tile on the rack, then the square it goes on. Touch a tile just laid to
// take it back. What the turn would score is shown before it is played; whether its words are
// real words is for the judge (the server, or the word list on the phone in practice).

export type TablePlayer = { seat: Seat; name: string; countryCode?: string | null; avatarUrl?: string | null; wins?: number | null }

/** A small in-page dialog (choose a letter, swap tiles, the rules). No browser pop-ups. */
export function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/55 sm:items-center" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()} className="max-h-[92dvh] w-full max-w-md overflow-y-auto border-t-4 border-brand bg-panel px-5 pb-[max(1.25rem,var(--safe-bottom))] pt-5 sm:border-4">
        <h2 className="font-display text-2xl font-extrabold text-primary">{title}</h2>
        {children}
      </div>
    </div>
  )
}

function TurnClock({ until }: { until: number }) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])
  const left = Math.max(0, Math.ceil((until - now) / 1000))
  return (
    <span role="timer" aria-label={t('words.clockLabel')} className={`px-1 text-xs font-bold tabular-nums ${left <= 10 ? 'bg-hibiscus text-white' : 'bg-brand text-brand-ink'}`} data-testid="words-clock">
      {left}
    </span>
  )
}

/** The colours of the bonus squares: the hub's own, each with its mark so colour is never the only sign. */
const BONUS_STYLE: Record<NonNullable<Bonus>, { className: string; mark: string }> = {
  DL: { className: 'bg-[#bcd0f5] text-[#1f2a7a]', mark: '2L' },
  TL: { className: 'bg-[#3d55c4] text-white', mark: '3L' },
  DW: { className: 'bg-[#f7d77a] text-[#5c4300]', mark: '2W' },
  TW: { className: 'bg-[#d1264f] text-white', mark: '3W' },
}

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

/** A tile the player has laid this turn and not yet played: where, and which tile of the rack. */
type Pending = { row: number; col: number; index: number; letter: string; blank: boolean }

type Props = {
  title: string
  /** Where the arrow back leads once the game is over. */
  backTo: string
  view: TableView
  /** The tiles of the person holding the device; empty for someone only watching. */
  rack: Tile[]
  players: TablePlayer[]
  mySeat: Seat | null
  /** When the player to move must have moved, on this device's clock; null when there is no clock. */
  deadline: number | null
  /** A request is on its way: nothing more may be asked for yet. */
  busy?: boolean
  /** Shown above the table, for example "Reconnecting". */
  notice?: ReactNode
  /** A line said instead of "Waiting for…" (practice: "The computer is thinking"). */
  waitingText?: string
  /** Each resolves true when the turn was taken, false when it was refused (the tiles then stay where they were laid). */
  onPlace: (tiles: Laid[]) => Promise<boolean> | boolean
  onSwap: (tiles: Tile[]) => Promise<boolean> | boolean
  onPass: () => Promise<boolean> | boolean
  chat?: ReactNode
  chatClosed?: boolean
  chatHeard?: number
  chatSent?: number
  /** The game's own choices in the menu: leave while it is on, what to do next once it is over. */
  menu?: ReactNode
  /** Shown under the table as well as in the menu: something in it is waiting for an answer. */
  menuPinned?: boolean
  /** Dialogs. */
  children?: ReactNode
}

export function WordsTable({ title, backTo, view, rack, players, mySeat, deadline, busy = false, notice, waitingText, onPlace, onSwap, onPass, chat, chatClosed = false, chatHeard = 0, chatSent = 0, menu, menuPinned = false, children }: Props) {
  const { t } = useTranslation()
  const [dialog, setDialog] = useState<'menu' | 'rules' | 'swap' | 'blank' | null>(null)
  const chatFold = useChatFold(chatHeard, chatSent)
  useLockedScreen()
  useEffect(() => preloadSounds(), [])

  const over = view.over !== null
  const player = (seat: Seat) => players.find((p) => p.seat === seat)
  const nameOf = (seat: Seat) => (seat === mySeat ? t('words.you') : (player(seat)?.name ?? ''))
  const myTurn = !over && mySeat !== null && view.turn === mySeat && !view.out.includes(mySeat)

  // The rack as the player has arranged it: the order of the tiles is theirs to shuffle. It
  // starts again from the server's order whenever the tiles themselves change.
  const rackKey = [...rack].sort().join('')
  const [order, setOrder] = useState<number[]>(() => rack.map((_, i) => i))
  const [pending, setPending] = useState<Pending[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  /** The square a blank is waiting to be laid on, while its letter is chosen. */
  const [blankFor, setBlankFor] = useState<{ row: number; col: number; index: number } | null>(null)
  const [swapping, setSwapping] = useState<number[]>([])
  const shownFor = useRef(`${rackKey}:${view.moveNo}`)
  useEffect(() => {
    const key = `${rackKey}:${view.moveNo}`
    if (key === shownFor.current) return
    shownFor.current = key
    setOrder(rack.map((_, i) => i))
    setPending([])
    setSelected(null)
    setSwapping([])
    // The rack is named by its tiles (rackKey): a new array holding the same tiles changes nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rackKey, view.moveNo])

  // What is heard as the game goes on: each thing that happens, once.
  const heard = useRef(view.moveNo)
  useEffect(() => {
    if (view.moveNo === heard.current) return
    heard.current = view.moveNo
    if (view.over) feedback('gameEnd')
    else if (view.lastEvent?.kind === 'place') feedback('card')
    else if (view.lastEvent) feedback('market')
  }, [view.moveNo, view.over, view.lastEvent])

  const laid: Laid[] = useMemo(() => pending.map((p) => ({ row: p.row, col: p.col, letter: p.letter, ...(p.blank ? { blank: true } : {}) })), [pending])
  const preview = useMemo(() => (laid.length > 0 ? evaluate(view.board, laid) : null), [view.board, laid])
  const pendingAt = (row: number, col: number) => pending.find((p) => p.row === row && p.col === col)
  // (For the one moment between new tiles arriving and the arrangement starting again, the old
  // arrangement may name tiles that are no longer there: the plain order is shown instead.)
  const arranged = order.length === rack.length ? order : rack.map((_, i) => i)
  const onRack = arranged.filter((index) => !pending.some((p) => p.index === index))
  const lastSquares = new Set(view.lastEvent?.kind === 'place' ? (view.lastEvent.squares ?? []) : [])

  const touchSquare = (row: number, col: number) => {
    if (!myTurn || busy) return
    const there = pendingAt(row, col)
    if (there) {
      // A tile just laid: back to the rack.
      setPending((list) => list.filter((p) => p !== there))
      feedback('market')
      return
    }
    if (selected === null || rack[selected] === undefined || cell(view.board, row, col) !== '.') return
    if (rack[selected] === '?') {
      setBlankFor({ row, col, index: selected })
      setDialog('blank')
      return
    }
    setPending((list) => [...list, { row, col, index: selected, letter: rack[selected]!, blank: false }])
    setSelected(null)
    feedback('card')
  }
  const recall = () => {
    setPending([])
    setSelected(null)
  }
  const shuffle = () => setOrder((current) => [...current].sort(() => Math.random() - 0.5))
  const play = async () => {
    if (!preview?.ok || busy) return
    // The tiles stay where they are until the judge has spoken: a refused word can be changed.
    await onPlace(laid)
  }

  // What just happened, in words.
  const event = view.lastEvent
  const said = !event
    ? ''
    : event.kind === 'place'
      ? t('words.event.place', { name: nameOf(event.seat), words: (event.words ?? []).map((w) => w.word.toUpperCase()).join(', '), count: event.score ?? 0 })
      : event.kind === 'swap'
        ? t('words.event.swap', { name: nameOf(event.seat), count: event.swapped ?? 0 })
        : t(`words.event.${event.kind}`, { name: nameOf(event.seat) })

  const status = over
    ? t('words.status.over')
    : myTurn
      ? t('words.status.yourTurn')
      : mySeat !== null
        ? (waitingText ?? t('words.status.waiting', { name: nameOf(view.turn) }))
        : t('words.status.turnOf', { name: nameOf(view.turn) })
  // Under the status: what the tiles laid would score, or why they cannot be played as they lie.
  const hint = !preview ? said : preview.ok ? t('words.preview', { words: preview.words.map((w) => w.word.toUpperCase()).join(', '), count: preview.score }) : t(`words.refusal.${preview.code}`)

  const seatChip = (seat: Seat) => {
    const who = player(seat)
    const gone = view.out.includes(seat)
    const toMove = !over && view.turn === seat
    return (
      <div key={seat} className={`flex min-w-0 flex-col border-2 px-1.5 py-1 ${toMove ? 'border-ink bg-panel' : 'border-transparent'} ${gone ? 'opacity-50' : ''}`} data-testid={`words-player-${seat}`} data-to-move={toMove} data-score={view.scores[seat] ?? 0} data-tiles={view.counts[seat] ?? 0}>
        <p className="flex items-center gap-1 truncate text-xs font-bold">
          {who?.countryCode && <span aria-hidden="true">{flagEmoji(who.countryCode)}</span>}
          <span className="truncate">{seat === mySeat ? t('words.you') : (who?.name ?? '')}</span>
          {toMove && deadline !== null && <TurnClock until={deadline} />}
        </p>
        <p className="flex items-baseline gap-1.5">
          <span className="font-display text-xl font-extrabold tabular-nums leading-none text-primary">{view.scores[seat] ?? 0}</span>
          <span className="truncate text-[0.65rem] text-muted">{gone ? t('words.out') : t('words.tiles', { count: view.counts[seat] ?? 0 })}</span>
        </p>
      </div>
    )
  }

  return (
    // The screen is fixed: exactly as high as the phone, and it never scrolls. The board is as
    // wide as the glass unless the phone is too short to show it whole with the rack under it.
    <div className="mx-auto flex h-(--app-h) w-full max-w-xl flex-col gap-1.5 overflow-hidden px-2 pb-[max(0.5rem,var(--safe-bottom))] pt-1 lg:max-w-2xl" data-testid="words-screen">
      <GameHeader title={title} over={over} backTo={backTo} />
      {notice && (
        <div role="status" className="shrink-0 bg-ink px-3 py-1.5 text-center text-sm font-semibold text-surface">
          {notice}
        </div>
      )}

      <div className="grid shrink-0 gap-1" style={{ gridTemplateColumns: `repeat(${view.seats.length}, minmax(0, 1fr))` }}>
        {view.seats.map(seatChip)}
      </div>

      <div className="flex min-h-0 shrink-0 justify-center">
        <div
          className="grid aspect-square w-full max-w-[min(100%,calc(var(--app-h)_-_19.5rem))] gap-px border-2 border-ink bg-ink"
          style={{ gridTemplateColumns: `repeat(${SIZE}, minmax(0, 1fr))` }}
          role="grid"
          aria-label={t('words.boardLabel')}
          data-testid="words-board"
          data-move-no={view.moveNo}
          data-turn={view.turn}
          data-bag={view.bagCount}
          data-over={over}
        >
          {Array.from({ length: SIZE * SIZE }, (_, at) => {
            const row = Math.floor(at / SIZE)
            const col = at % SIZE
            const square = cell(view.board, row, col)
            const mine = pendingAt(row, col)
            const bonus = bonusAt(row, col)
            const label = square !== '.' ? t('words.squareTile', { row: row + 1, col: col + 1, letter: square.toUpperCase() }) : t('words.square', { row: row + 1, col: col + 1 })
            return (
              <button
                key={at}
                type="button"
                role="gridcell"
                aria-label={label}
                onClick={() => touchSquare(row, col)}
                data-square={`${row}-${col}`}
                data-letter={square !== '.' ? square : (mine?.letter ?? '')}
                className={`relative flex aspect-square items-center justify-center text-[clamp(0.5rem,2.6vw,0.95rem)] ${square === '.' && !mine ? (bonus ? BONUS_STYLE[bonus].className : 'bg-[#e9ecf7]') : 'bg-[#e9ecf7]'}`}
              >
                {square !== '.' ? (
                  <TileFace letter={square.toLowerCase()} blank={square !== square.toLowerCase()} className={`size-full ${lastSquares.has(at) ? 'ring-2 ring-inset ring-palm' : ''}`} small />
                ) : mine ? (
                  <TileFace letter={mine.letter} blank={mine.blank} className="size-full ring-2 ring-inset ring-brand" small />
                ) : bonus ? (
                  <span className="text-[58%] font-bold leading-none" aria-hidden="true">
                    {row === 7 && col === 7 ? '★' : BONUS_STYLE[bonus].mark}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1 text-center">
        <p className="font-display text-base font-extrabold leading-tight text-primary" role="status" data-testid="words-status">
          {status}
          <span className="ms-2 font-sans text-xs font-semibold text-muted" data-testid="words-bag">
            {t('words.bag', { count: view.bagCount })}
          </span>
        </p>
        <p className={`min-h-5 text-sm leading-tight ${preview && !preview.ok ? 'font-semibold text-hibiscus' : 'text-muted'}`} data-testid="words-hint">
          {hint}
        </p>
      </div>

      {/* The player's own rack, and what to do with it. */}
      {mySeat !== null && !over && (
        <>
          <div className="mx-auto grid w-full max-w-sm shrink-0 grid-cols-7 gap-1" role="group" aria-label={t('words.rackLabel')} data-testid="words-rack">
            {Array.from({ length: RACK_SIZE }, (_, slot) => {
              const index = onRack[slot]
              if (index === undefined) return <span key={`empty-${slot}`} className="aspect-square rounded-[14%] border border-dashed border-line" aria-hidden="true" />
              const tile = rack[index]!
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => myTurn && !busy && setSelected(selected === index ? null : index)}
                  aria-pressed={selected === index}
                  aria-label={tile === '?' ? t('words.blankTile') : t('words.tile', { letter: tile.toUpperCase(), count: TILE_VALUES[tile] ?? 0 })}
                  data-tile={tile}
                  className={`text-2xl transition-transform ${selected === index ? '-translate-y-2' : ''} ${myTurn ? '' : 'opacity-70'}`}
                >
                  <TileFace letter={tile} className={`w-full ${selected === index ? 'ring-4 ring-brand' : ''}`} />
                </button>
              )
            })}
          </div>
          <div className="grid shrink-0 grid-cols-[1fr_1fr_1fr_1.6fr] gap-1.5 *:min-h-11 *:px-1 *:text-sm">
            <Button variant="ghost" onClick={shuffle} disabled={onRack.length < 2}>
              {t('words.shuffle')}
            </Button>
            <Button variant="ghost" onClick={() => setDialog('swap')} disabled={!myTurn || busy || view.bagCount < RACK_SIZE}>
              {t('words.swap')}
            </Button>
            {pending.length > 0 ? (
              <Button variant="ghost" onClick={recall} disabled={busy}>
                {t('words.recall')}
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => void onPass()} disabled={!myTurn || busy} data-testid="words-pass">
                {t('words.pass')}
              </Button>
            )}
            <Button onClick={() => void play()} disabled={!myTurn || busy || !preview?.ok} data-testid="words-play">
              {preview?.ok ? t('words.playFor', { count: preview.score }) : t('words.play')}
            </Button>
          </div>
        </>
      )}

      {chat && (
        <ChatFold open={chatFold.open} onClose={chatFold.hide}>
          {chat}
        </ChatFold>
      )}
      {menuPinned && <div className="shrink-0">{menu}</div>}

      <GameBar onMenu={() => setDialog('menu')} chat={chat ? { closed: chatClosed, news: chatFold.news, onOpen: chatFold.show } : null} />

      {dialog === 'menu' && (
        <GameMenu onClose={() => setDialog(null)}>
          {menu && <div onClick={() => setDialog(null)}>{menu}</div>}
          <Button variant="ghost" onClick={() => setDialog('rules')}>
            {t('gameMenu.rules')}
          </Button>
        </GameMenu>
      )}

      {dialog === 'blank' && blankFor && (
        <Sheet title={t('words.blankTitle')} onClose={() => setDialog(null)}>
          <p className="mt-1 text-muted">{t('words.blankBody')}</p>
          <div className="mt-4 grid grid-cols-7 gap-1.5" role="group" aria-label={t('words.blankTitle')}>
            {[...'abcdefghijklmnopqrstuvwxyz'].map((letter) => (
              <button
                key={letter}
                type="button"
                aria-label={letter.toUpperCase()}
                data-letter={letter}
                onClick={() => {
                  setPending((list) => [...list, { ...blankFor, letter, blank: true }])
                  setSelected(null)
                  setBlankFor(null)
                  setDialog(null)
                  feedback('card')
                }}
                className="text-xl"
              >
                <TileFace letter={letter} blank className="w-full" />
              </button>
            ))}
          </div>
          <Button variant="ghost" className="mt-4 w-full" onClick={() => setDialog(null)}>
            {t('gameMenu.cancel')}
          </Button>
        </Sheet>
      )}

      {dialog === 'swap' && (
        <Sheet title={t('words.swapTitle')} onClose={() => setDialog(null)}>
          <p className="mt-1 text-muted">{t('words.swapBody')}</p>
          <div className="mt-4 grid grid-cols-7 gap-1.5" role="group" aria-label={t('words.swapTitle')}>
            {rack.map((tile, index) => (
              <button
                key={index}
                type="button"
                aria-pressed={swapping.includes(index)}
                aria-label={tile === '?' ? t('words.blankTile') : tile.toUpperCase()}
                onClick={() => setSwapping((list) => (list.includes(index) ? list.filter((i) => i !== index) : [...list, index]))}
                className={`text-2xl transition-transform ${swapping.includes(index) ? '-translate-y-1.5' : ''}`}
              >
                <TileFace letter={tile} className={`w-full ${swapping.includes(index) ? 'ring-4 ring-brand' : ''}`} />
              </button>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)}>
              {t('gameMenu.cancel')}
            </Button>
            <Button
              disabled={swapping.length === 0 || busy}
              data-testid="words-swap-confirm"
              onClick={() => {
                const tiles = swapping.map((index) => rack[index]!)
                setDialog(null)
                setPending([])
                void onSwap(tiles)
              }}
            >
              {t('words.swapConfirm', { count: swapping.length })}
            </Button>
          </div>
        </Sheet>
      )}

      {dialog === 'rules' && (
        <Sheet title={t('words.rules.title')} onClose={() => setDialog(null)}>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {(t('words.rules.lines', { returnObjects: true }) as string[]).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <Button className="mt-4 w-full" onClick={() => setDialog(null)}>
            {t('common.close')}
          </Button>
        </Sheet>
      )}

      {children}
    </div>
  )
}

/** Once it is over: each player's final score, and the tiles they were left with. */
export function FinalScores({ view, players, mySeat }: { view: TableView; players: TablePlayer[]; mySeat: Seat | null }) {
  const { t } = useTranslation()
  if (!view.over) return null
  const scores = view.over.scores
  const order = [...view.seats].filter((seat) => !view.out.includes(seat)).sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0))
  return (
    <ul className="flex flex-col gap-2" data-testid="words-final">
      {order.map((seat) => (
        <li key={seat} className="flex items-center gap-2">
          <span className="w-24 shrink-0 truncate text-sm font-bold">{seat === mySeat ? t('words.you') : (players.find((p) => p.seat === seat)?.name ?? '')}</span>
          <span className="flex min-w-0 flex-1 gap-0.5 text-xs">
            {(view.over?.racks?.[seat] ?? []).map((tile, index) => (
              <TileFace key={`${tile}-${index}`} letter={tile} className="w-5 shrink-0" small />
            ))}
          </span>
          <span className="w-10 shrink-0 text-end font-display text-xl font-extrabold tabular-nums" data-testid={`words-final-${seat}`}>
            {scores[seat] ?? 0}
          </span>
        </li>
      ))}
    </ul>
  )
}
