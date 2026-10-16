import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/core/settings/settingsStore'
import { Avatar } from '@/core/ui/Avatar'
import { Button } from '@/core/ui/Button'
import { ChatFold, GameBar, GameHeader, GameMenu, GearIcon, useChatFold, useLockedScreen } from '@/core/ui/gameScreen'
import { ResultDialog, ResultStat, ResultStats, type ResultTone } from '@/core/ui/ResultDialog'
import { Toggle } from '@/core/ui/Toggle'
import { type ClockState, formatClock, LOW_TIME_MS, remainingMs, TENTHS_BELOW_MS } from '@/games/chess/engine/clock'
import { legalPits, type Played, type Side, START, TO_WIN } from '../../../supabase/functions/_shared/oware'
import { type BoardMove, OwareBoard } from './OwareBoard'
import { feedback, preloadSounds } from './sound'
import { clockColor, type OwareController } from './useLocalOwareGame'

/** A small in-page dialog (confirm resign, answer a draw offer, the result). No browser pop-ups. */
export function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/55 sm:items-center" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="glass max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-line px-5 pb-[max(1.25rem,var(--safe-bottom))] pt-5 sm:rounded-3xl sm:border"
      >
        <h2 className="font-display text-2xl font-extrabold text-accent">{title}</h2>
        {children}
      </div>
    </div>
  )
}

/**
 * One player's clock. It counts down smoothly on the device between updates, but it only ever
 * shows what follows from the clock values it is given: it never decides that time has run out.
 */
function Clock({ clock, side }: { clock: ClockState; side: Side }) {
  const { t } = useTranslation()
  const color = clockColor(side)
  const active = clock.running === color
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(id)
  }, [active, clock.since])

  const left = remainingMs(clock, color, now)
  const low = left <= LOW_TIME_MS
  return (
    <div
      role="timer"
      aria-label={t(side === 's' ? 'oware.clockSouth' : 'oware.clockNorth')}
      data-testid={`clock-${side}`}
      data-active={active}
      className={`min-w-[5.5rem] px-3 py-1.5 text-end font-sans text-2xl font-bold tabular-nums ${low ? 'bg-hibiscus text-white' : active ? 'bg-brand text-brand-ink' : 'bg-line/60 text-muted'} ${left < TENTHS_BELOW_MS ? 'min-w-[6.5rem]' : ''}`}
    >
      {formatClock(left)}
    </div>
  )
}

export type TablePlayer = { name: string; flag?: string; avatarUrl?: string; rating?: number; /** How the rating moved, once the game is settled. */ ratingChange?: number }

function PlayerCard({ player, side, taken, clock, toMove }: { player: TablePlayer; side: Side; taken: number; clock?: ClockState; toMove: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3" data-testid={`player-${side}`}>
      <Avatar url={player.avatarUrl} name={player.name} className="size-10 shrink-0 rounded-full text-lg" />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2 truncate font-bold">
          {player.flag && <span aria-hidden="true">{player.flag}</span>}
          <span className="truncate">{player.name}</span>
          {player.rating !== undefined && <span className="text-sm font-semibold tabular-nums text-muted">{player.rating}</span>}
          {player.ratingChange !== undefined && (
            <span className={`text-sm font-bold tabular-nums ${player.ratingChange > 0 ? 'text-good' : player.ratingChange < 0 ? 'text-alert' : 'text-muted'}`}>
              {player.ratingChange > 0 ? `+${player.ratingChange}` : player.ratingChange < 0 ? `−${Math.abs(player.ratingChange)}` : '±0'}
            </span>
          )}
          {toMove && <span className="size-2 shrink-0 rounded-full bg-palm" aria-hidden="true" />}
        </p>
        {/* Seeds taken, on the way to the 25 that win. */}
        <div className="mt-1 flex items-center gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-line" aria-hidden="true">
            <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${Math.min(100, (taken / TO_WIN) * 100)}%` }} />
          </div>
          <span className="text-sm font-semibold tabular-nums text-muted" data-testid={`taken-${side}`}>
            {t('oware.taken', { count: taken })}
          </span>
        </div>
      </div>
      {clock && <Clock clock={clock} side={side} />}
    </div>
  )
}

/** Moves in the usual notation, with buttons to step back and forward through the game. */
function MoveList({ played, viewPly, onView }: { played: Played[]; viewPly: number; onView: (ply: number) => void }) {
  const { t } = useTranslation()
  const current = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    current.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [viewPly, played.length])

  return (
    <div className="flex shrink-0 items-center lg:min-h-48 lg:flex-1 lg:items-stretch">
      <ol
        className="flex min-h-11 flex-1 items-center gap-x-1 overflow-x-auto whitespace-nowrap border border-line bg-panel px-2 lg:grid lg:min-h-0 lg:grid-cols-2 lg:content-start lg:items-stretch lg:gap-x-3 lg:gap-y-0.5 lg:overflow-y-auto lg:overflow-x-hidden lg:p-2"
        aria-label={t('oware.moves.title')}
      >
        {played.length === 0 && <li className="text-sm text-muted lg:col-span-2">{t('oware.moves.none')}</li>}
        {played.map((move, index) => {
          const ply = index + 1
          return (
            <li key={ply} className="flex items-center">
              {move.side === 's' && <span className="me-1 text-sm tabular-nums text-muted lg:w-8">{(ply + 1) / 2}.</span>}
              <button
                type="button"
                ref={ply === viewPly ? current : undefined}
                aria-current={ply === viewPly ? 'step' : undefined}
                onClick={() => onView(ply)}
                className={`min-h-9 rounded-lg px-1.5 text-base font-semibold tabular-nums lg:flex-1 lg:text-start ${ply === viewPly ? 'bg-primary text-fg' : 'lg:hover:bg-line/60'}`}
              >
                {move.notation}
                {move.taken > 0 && <span className="text-good">×{move.taken}</span>}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

type Props = {
  title: string
  game: OwareController
  players: Record<Side, TablePlayer>
  /** Which pits the person at this screen may play; 'none' for someone watching. */
  movable: Side | 'none'
  /** The side this screen belongs to ("You won"); null for someone watching. */
  perspective: Side | null
  timed: boolean
  /** Online games: draws are offered to, and answered by, the other player. */
  onlineDraws?: boolean
  /** Before both players have moved: leaving simply calls the game off. */
  canAbort?: boolean
  chat?: ReactNode
  chatClosed?: boolean
  chatHeard?: number
  chatSent?: number
  /** What to do once the game is over is also shown under the board while this is true. */
  overActionsPinned?: boolean
  /** Shown above the board, for example "Reconnecting". */
  notice?: ReactNode
  overActions: ReactNode
  tokensChange?: number
  rating?: number
  ratingChange?: number
  /** Practice only: take the last move back. */
  onUndo?: () => void
  canUndo?: boolean
  /** A line under the board, for example "The computer is thinking". */
  status?: ReactNode
  /** Where the back arrow goes. */
  backTo?: string
  /** True while the board is playing a move out (the computer waits for it before answering). */
  onBusyChange?: (busy: boolean) => void
}

const SPLIT_ENDINGS = new Set(['no_moves', 'repetition', 'no_captures'])

/** The whole Oware screen: both player cards, the board, the moves and the controls. */
export function OwareTable({ title, game, players, movable, perspective, timed, onlineDraws, canAbort, chat, chatClosed = false, chatHeard = 0, chatSent = 0, overActionsPinned = false, notice, overActions, tokensChange, rating, ratingChange, onUndo, canUndo, status, backTo = '/play/oware', onBusyChange }: Props) {
  const { t } = useTranslation()
  const settings = useSettingsStore()
  const [flipped, setFlipped] = useState(false)
  // Null means "follow the game"; a number means the player is looking back at that move.
  const [viewPly, setViewPly] = useState<number | null>(null)
  const [dialog, setDialog] = useState<'resign' | 'settings' | 'rules' | 'menu' | null>(null)
  const chatFold = useChatFold(chatHeard, chatSent)
  useLockedScreen()
  const [resultClosed, setResultClosed] = useState(false)
  // Less motion for those who asked for it.
  const [reducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => preloadSounds(), [])

  const { state, played, turn, outcome } = game
  const livePly = played.length
  const shownPly = Math.min(viewPly ?? livePly, livePly)
  const atLive = shownPly === livePly
  // The board as the move left it, what each player had taken by then, and the move itself.
  const pits = shownPly === 0 ? START : played[shownPly - 1]!.pitsAfter
  const storesAt = useCallback(
    (ply: number) => {
      const counts: Record<Side, number> = { s: 0, n: 0 }
      for (const move of played.slice(0, ply)) counts[move.side] += move.taken
      return counts
    },
    [played],
  )
  const stores = useMemo(() => storesAt(shownPly), [storesAt, shownPly])
  const lastMove = useMemo<BoardMove | null>(
    () => (shownPly > 0 ? { ...played[shownPly - 1]!, from: shownPly === 1 ? START : played[shownPly - 2]!.pitsAfter, storesBefore: storesAt(shownPly - 1), ply: shownPly } : null),
    [played, shownPly, storesAt],
  )
  // At the end of a game decided by sharing out the seeds, the board shares them out.
  const shareOut = atLive && outcome && SPLIT_ENDINGS.has(outcome.reason) ? state.stores : null
  // What the cards show follows the board, seed by seed, as the stores fill.
  const [taken, setTaken] = useState<Record<Side, number>>(stores)
  const [boardBusy, setBoardBusy] = useState(false)
  const busyChanged = useCallback(
    (busy: boolean) => {
      setBoardBusy(busy)
      onBusyChange?.(busy)
    },
    [onBusyChange],
  )

  // The pits on offer to this player, worked out with the same rules the server judges by.
  const playable = useMemo(() => (atLive && !outcome && movable === turn ? legalPits(state) : []), [atLive, outcome, movable, turn, state])
  const mustFeed = playable.length > 0 && state.pits.slice(turn === 's' ? 6 : 0, turn === 's' ? 12 : 6).every((seeds) => seeds === 0)

  const home: Side = perspective ?? 's'
  const away: Side = home === 's' ? 'n' : 's'
  const bottom: Side = flipped ? away : home
  const top: Side = bottom === 's' ? 'n' : 's'
  const over = outcome !== null
  useEffect(() => {
    if (!over) setResultClosed(false)
  }, [over])
  // The result comes once the last seeds are in the stores, with the closing sound.
  const resultReady = over && !boardBusy
  const [sounded, setSounded] = useState(false)
  useEffect(() => {
    if (!resultReady) {
      if (!over) setSounded(false)
      return
    }
    if (!sounded) {
      setSounded(true)
      feedback('gameEnd')
    }
  }, [resultReady, over, sounded])

  const card = (side: Side) => <PlayerCard player={players[side]} side={side} taken={taken[side]} clock={timed ? game.clock : undefined} toMove={!outcome && turn === side} />
  const view = (ply: number) => setViewPly(ply >= livePly ? null : Math.max(0, ply))

  // Computer keyboard: the arrow keys step through the game.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key === 'ArrowLeft') setViewPly((current) => Math.max(0, (current ?? livePly) - 1))
      if (event.key === 'ArrowRight') setViewPly((current) => (current === null || current + 1 >= livePly ? null : current + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [livePly])

  const called = outcome?.reason === 'aborted' || outcome?.reason === 'called_off'
  const resultTitle = !outcome
    ? ''
    : called
      ? t('oware.over.aborted')
      : outcome.winner === null
        ? t('oware.over.draw')
        : perspective === null
          ? t('oware.over.wins', { name: players[outcome.winner].name })
          : t(outcome.winner === perspective ? 'oware.over.youWon' : 'oware.over.youLost')
  const resultTone: ResultTone = called ? 'neutral' : !outcome || outcome.winner === null ? 'draw' : perspective === null || outcome.winner === perspective ? 'win' : 'loss'
  const lastPlayed = played.at(-1)

  return (
    // The screen is fixed: exactly as high as the phone, and it never scrolls. Phone: one column
    // (title, board, moves, bar); computer: the board beside a panel with the moves and controls.
    <div className="mx-auto flex h-(--app-h) w-full max-w-xl flex-col gap-2 overflow-hidden px-3 pb-[max(0.5rem,var(--safe-bottom))] pt-1 lg:grid lg:max-w-none lg:grid-cols-[min(calc(100vw-30rem),46rem)_24rem] lg:grid-rows-[auto_minmax(0,1fr)_auto] lg:justify-center lg:gap-x-8 lg:gap-y-3 lg:px-8 lg:py-4">
      <GameHeader title={title} over={over} backTo={backTo} className="lg:col-start-2 lg:row-start-1" />

      <div className="flex shrink-0 flex-col lg:col-start-1 lg:row-span-3 lg:row-start-1 lg:justify-center">
        <div className="mx-auto flex w-full flex-col gap-3 lg:gap-4">
          {notice && (
            <div role="status" className="bg-ink px-3 py-1.5 text-center text-sm font-semibold text-fg">
              {notice}
            </div>
          )}
          {card(top)}
          <OwareBoard
            pits={pits}
            near={bottom}
            playable={playable}
            onPlay={(pit) => {
              if (!game.tryMove(pit)) feedback('illegal')
            }}
            stores={stores}
            lastMove={lastMove}
            collector={movable === 'none' ? null : movable}
            shareOut={shareOut}
            animate={!settings.dataSaver && !reducedMotion}
            onBusyChange={busyChanged}
            onStoresShown={setTaken}
          />
          {card(bottom)}
        </div>
      </div>

      <aside className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto lg:col-start-2 lg:row-start-2 lg:border lg:border-line lg:bg-panel lg:p-4">
        <div className="min-h-6 text-center text-sm font-semibold text-muted" role="status">
          {status ??
            (mustFeed ? (
              t('oware.mustFeed')
            ) : atLive && !boardBusy && lastPlayed?.grandSlam ? (
              t('oware.grandSlam')
            ) : atLive && !boardBusy && lastPlayed && lastPlayed.taken > 0 ? (
              t('oware.justTook', { name: players[lastPlayed.side].name, count: lastPlayed.taken })
            ) : (
              <span aria-hidden="true">&nbsp;</span>
            ))}
        </div>

        <MoveList played={played} viewPly={shownPly} onView={view} />
        {chat && (
          <ChatFold open={chatFold.open} onClose={chatFold.hide}>
            {chat}
          </ChatFold>
        )}

        {outcome ? overActionsPinned && overActions : !atLive && <Button onClick={() => setViewPly(null)}>{t('oware.moves.backToGame')}</Button>}
      </aside>

      <GameBar
        className="lg:col-start-2 lg:row-start-3"
        onMenu={() => setDialog('menu')}
        chat={chat ? { closed: chatClosed, news: chatFold.news, onOpen: chatFold.show } : null}
        steps={{
          atStart: shownPly === 0,
          atEnd: shownPly >= livePly,
          onPrevious: () => view(shownPly - 1),
          onNext: () => view(shownPly + 1),
          previousLabel: t('oware.moves.previous'),
          nextLabel: t('oware.moves.next'),
        }}
      />

      {dialog === 'menu' && (
        <GameMenu onClose={() => setDialog(null)}>
          {outcome && <div onClick={() => setDialog(null)}>{overActions}</div>}
          {!outcome && atLive && onlineDraws && perspective && (
            <Button
              variant="ghost"
              disabled={livePly < 2 || game.drawOfferBy !== null}
              onClick={() => {
                setDialog(null)
                game.offerDraw(perspective)
              }}
            >
              {game.drawOfferBy === perspective ? t('oware.actions.drawOffered') : t('oware.actions.draw')}
            </Button>
          )}
          {!outcome && atLive && onUndo && (
            <Button
              variant="ghost"
              disabled={!canUndo}
              onClick={() => {
                setDialog(null)
                onUndo()
              }}
            >
              {t('oware.actions.undo')}
            </Button>
          )}
          {!outcome && movable !== 'none' && (
            <Button variant="ghost" onClick={() => setDialog('resign')}>
              {canAbort ? t('oware.actions.abort') : t('oware.actions.resign')}
            </Button>
          )}
          {outcome && resultClosed && (
            <Button
              variant="ghost"
              onClick={() => {
                setDialog(null)
                setResultClosed(false)
              }}
              data-testid="show-result"
            >
              {t('oware.over.showResult')}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setDialog('rules')}>
            {t('gameMenu.rules')}
          </Button>
          <Button variant="ghost" onClick={() => setDialog('settings')}>
            <span className="me-2 inline-flex align-middle">
              <GearIcon />
            </span>
            {t('gameMenu.settings')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setDialog(null)
              setFlipped((f) => !f)
            }}
          >
            {t('oware.actions.flip')}
          </Button>
        </GameMenu>
      )}

      {dialog === 'resign' && !outcome && perspective && (
        <Sheet title={canAbort ? t('oware.abort.title') : t('oware.resign.title')} onClose={() => setDialog(null)}>
          <p className="mt-1 text-muted">{canAbort ? t('oware.abort.body') : t('oware.resign.body', { opponent: players[away].name })}</p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)}>
              {t('oware.resign.cancel')}
            </Button>
            <Button
              className="bg-hibiscus text-white active:bg-hibiscus"
              onClick={() => {
                setDialog(null)
                game.resign(perspective)
              }}
            >
              {canAbort ? t('oware.abort.confirm') : t('oware.resign.confirm')}
            </Button>
          </div>
        </Sheet>
      )}

      {/* Only the player who received the offer is asked; the one who made it waits. */}
      {game.drawOfferBy && !outcome && perspective && game.drawOfferBy !== perspective && (
        <Sheet title={t('oware.drawOffer.title', { name: players[game.drawOfferBy].name })}>
          <p className="mt-1 text-muted">{t('oware.drawOffer.body')}</p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => game.respondToDraw(false)}>
              {t('oware.drawOffer.decline')}
            </Button>
            <Button onClick={() => game.respondToDraw(true)}>{t('oware.drawOffer.accept')}</Button>
          </div>
        </Sheet>
      )}

      {outcome && resultReady && !resultClosed && (
        <ResultDialog
          title={resultTitle}
          tone={resultTone}
          reason={t(`oware.over.reason.${outcome.reason}`, { defaultValue: t('oware.over.reason.other') })}
          onClose={() => setResultClosed(true)}
          closeLabel={t('oware.over.close')}
        >
          <ResultStats>
            <ResultStat testId="game-over-seeds" label={t('oware.over.seeds')} value={`${taken[perspective ?? 's']} – ${taken[perspective === 'n' ? 's' : 'n']}`} />
            {ratingChange !== undefined && <ResultStat testId="game-over-rating" label={t('oware.over.rating')} value={rating ?? ''} change={ratingChange} />}
            {tokensChange !== undefined && <ResultStat testId="game-over-tokens" label={t('oware.over.tokens')} change={tokensChange} />}
          </ResultStats>
          <div>{overActions}</div>
        </ResultDialog>
      )}

      {dialog === 'settings' && (
        <Sheet title={t('oware.settings.title')} onClose={() => setDialog(null)}>
          <div className="mt-4 divide-y divide-line border-y border-line">
            <Toggle
              label={t('oware.settings.sound')}
              on={settings.soundOn}
              onChange={(soundOn) => {
                settings.set({ soundOn })
                if (soundOn) feedback('move')
              }}
            />
            <Toggle label={t('oware.settings.haptics')} on={settings.hapticsOn} onChange={(hapticsOn) => settings.set({ hapticsOn })} />
          </div>
          <Button className="mt-5 w-full" onClick={() => setDialog(null)}>
            {t('oware.settings.done')}
          </Button>
        </Sheet>
      )}

      {dialog === 'rules' && (
        <Sheet title={t('oware.rules.title')} onClose={() => setDialog(null)}>
          <ul className="mt-3 flex list-disc flex-col gap-2 ps-5 text-[0.95rem]">
            {(['board', 'sow', 'lap', 'capture', 'grandSlam', 'feed', 'win', 'end'] as const).map((rule) => (
              <li key={rule}>{t(`oware.rules.${rule}`)}</li>
            ))}
          </ul>
          <Button className="mt-5 w-full" onClick={() => setDialog(null)}>
            {t('oware.settings.done')}
          </Button>
        </Sheet>
      )}
    </div>
  )
}
