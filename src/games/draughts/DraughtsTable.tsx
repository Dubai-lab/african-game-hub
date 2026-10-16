import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/core/settings/settingsStore'
import { Avatar } from '@/core/ui/Avatar'
import { Button } from '@/core/ui/Button'
import { ChatFold, GameBar, GameHeader, GameMenu, GearIcon, useChatFold, useLockedScreen } from '@/core/ui/gameScreen'
import { ResultDialog, ResultStat, ResultStats, type ResultTone } from '@/core/ui/ResultDialog'
import { Toggle } from '@/core/ui/Toggle'
import { type ClockState, formatClock, LOW_TIME_MS, remainingMs, TENTHS_BELOW_MS } from '@/games/chess/engine/clock'
import { type Color, legalMoves, material, type Move, type Played, START } from '../../../supabase/functions/_shared/draughts'
import { DraughtsBoard } from './DraughtsBoard'
import DraughtsSettings from './DraughtsSettings'
import { feedback, preloadSounds } from './sound'
import { DRAUGHTS_BOARDS, DRAUGHTS_PIECES } from './themes'
import type { DraughtsController } from './useLocalDraughtsGame'

/** A small in-page dialog (confirm resign, answer a draw offer, the result). No browser pop-ups. */
export function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/55 sm:items-center" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto glass rounded-t-3xl border-t border-line px-5 pb-[max(1.25rem,var(--safe-bottom))] pt-5 sm:rounded-3xl sm:border"
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
function Clock({ clock, color }: { clock: ClockState; color: Color }) {
  const { t } = useTranslation()
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
      aria-label={t(color === 'w' ? 'draughts.clockWhite' : 'draughts.clockBlack')}
      data-testid={`clock-${color}`}
      data-active={active}
      className={`min-w-[5.5rem] px-3 py-1.5 text-end font-sans text-2xl font-bold tabular-nums ${low ? 'bg-hibiscus text-white' : active ? 'bg-brand text-brand-ink' : 'bg-line/60 text-muted'} ${left < TENTHS_BELOW_MS ? 'min-w-[6.5rem]' : ''}`}
    >
      {formatClock(left)}
    </div>
  )
}

export type TablePlayer = { name: string; flag?: string; avatarUrl?: string; rating?: number; /** How the rating moved, once the game is settled. */ ratingChange?: number }

function PlayerCard({ player, color, taken, lead, clock, toMove, disc }: { player: TablePlayer; color: Color; taken: number; lead: number; clock?: ClockState; toMove: boolean; disc: { top: string; edge: string } }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3" data-testid={`player-${color}`}>
      {/* The ring is the colour of the player's pieces, photo or no photo. */}
      <div className="shrink-0 rounded-full border-4" style={{ borderColor: disc.edge, background: disc.top, color: color === 'w' ? '#1b1919' : '#ffffff' }}>
        <Avatar url={player.avatarUrl} name={player.name} className="size-9 rounded-full text-lg" tileClassName="" />
      </div>
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
        <p className="h-5 text-sm font-semibold tabular-nums text-muted" data-testid={`taken-${color}`}>
          {taken > 0 && t('draughts.taken', { count: taken })}
          {lead > 0 && <span className="ms-1.5 font-bold text-fg">+{lead}</span>}
        </p>
      </div>
      {clock && <Clock clock={clock} color={color} />}
    </div>
  )
}

/** Moves in the standard notation, with buttons to step back and forward through the game. */
function MoveList({ played, viewPly, onView }: { played: Played[]; viewPly: number; onView: (ply: number) => void }) {
  const { t } = useTranslation()
  const current = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    current.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [viewPly, played.length])

  return (
    // Stepping back and forward is done from the bar under it.
    <div className="flex shrink-0 items-center lg:min-h-48 lg:flex-1 lg:items-stretch">
      <ol
        className="flex min-h-11 flex-1 items-center gap-x-1 overflow-x-auto whitespace-nowrap border border-line bg-panel px-2 lg:grid lg:min-h-0 lg:grid-cols-2 lg:content-start lg:items-stretch lg:gap-x-3 lg:gap-y-0.5 lg:overflow-y-auto lg:overflow-x-hidden lg:bg-surface lg:p-2"
        aria-label={t('draughts.moves.title')}
      >
        {played.length === 0 && <li className="text-sm text-muted lg:col-span-2">{t('draughts.moves.none')}</li>}
        {played.map((move, index) => {
          const ply = index + 1
          return (
            <li key={ply} className="flex items-center">
              {move.color === 'w' && <span className="me-1 text-sm tabular-nums text-muted lg:w-8">{(ply + 1) / 2}.</span>}
              <button
                type="button"
                ref={ply === viewPly ? current : undefined}
                aria-current={ply === viewPly ? 'step' : undefined}
                onClick={() => onView(ply)}
                className={`min-h-9 px-1.5 text-base font-semibold tabular-nums lg:flex-1 lg:text-start ${ply === viewPly ? 'bg-primary text-fg' : 'lg:hover:bg-line/60'}`}
              >
                {move.notation}
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
  game: DraughtsController
  players: Record<Color, TablePlayer>
  /** Which pieces the person at this screen may move; 'none' for someone watching. */
  movable: Color | 'none'
  /** The side this screen belongs to ("You won"); null for someone watching. */
  perspective: Color | null
  timed: boolean
  /** Online games: draws are offered to, and answered by, the other player. */
  onlineDraws?: boolean
  /** Before both players have moved: leaving simply calls the game off. */
  canAbort?: boolean
  chat?: ReactNode
  /** The chat is over: the opponent has left the finished game. The chat button says so. */
  chatClosed?: boolean
  /** Goes up by one each time the opponent says something: the chat button shows there is news. */
  chatHeard?: number
  /** Goes up by one each time this player sends a quick message: the chat is put away. */
  chatSent?: number
  /**
   * What to do once the game is over is on the result card and in the menu. It is also shown
   * under the board only while this is true: something is waiting for an answer (a rematch
   * asked for, a search for a new opponent).
   */
  overActionsPinned?: boolean
  /** Shown above the board, for example "Reconnecting". */
  notice?: ReactNode
  /** What the player can do once the game is over. */
  overActions: ReactNode
  /** Online games, once settled: shown on the result screen. */
  tokensChange?: number
  rating?: number
  ratingChange?: number
  /** Practice only: take the last move back. */
  onUndo?: () => void
  canUndo?: boolean
  /** A line under the board, for example "The computer is thinking". */
  status?: ReactNode
}

/** The whole draughts screen: both player cards, the board, the moves and the controls. */
export function DraughtsTable({ title, game, players, movable, perspective, timed, onlineDraws, canAbort, chat, chatClosed = false, chatHeard = 0, chatSent = 0, overActionsPinned = false, notice, overActions, tokensChange, rating, ratingChange, onUndo, canUndo, status }: Props) {
  const { t } = useTranslation()
  const settings = useSettingsStore()
  const [flipped, setFlipped] = useState(false)
  // Null means "follow the game"; a number means the player is looking back at that move.
  const [viewPly, setViewPly] = useState<number | null>(null)
  const [dialog, setDialog] = useState<'resign' | 'settings' | 'rules' | 'menu' | null>(null)
  const chatFold = useChatFold(chatHeard, chatSent)
  useLockedScreen()
  const [resultClosed, setResultClosed] = useState(false)

  useEffect(() => preloadSounds(), [])

  const { state, played, turn, outcome } = game
  const livePly = played.length
  const shownPly = Math.min(viewPly ?? livePly, livePly)
  const atLive = shownPly === livePly
  const board = shownPly === 0 ? START : played[shownPly - 1]!.boardAfter
  const lastMove: Move | null = shownPly > 0 ? played[shownPly - 1]! : null

  // The moves on offer to this player, worked out with the same rules the server judges by.
  const moves = useMemo(() => (atLive && !outcome && movable === turn ? legalMoves(state) : []), [atLive, outcome, movable, turn, state])
  const count = useMemo(() => material(board), [board])
  const taken = { w: 20 - count.b.men - count.b.kings, b: 20 - count.w.men - count.w.kings }
  // A king is worth about three men when judging who is ahead.
  const worth = { w: count.w.men + count.w.kings * 3, b: count.b.men + count.b.kings * 3 }

  const home: Color = perspective ?? 'w'
  const away: Color = home === 'w' ? 'b' : 'w'
  const bottom: Color = flipped ? away : home
  const top: Color = bottom === 'w' ? 'b' : 'w'
  const pieces = DRAUGHTS_PIECES[settings.draughtsPieces]
  const over = outcome !== null
  useEffect(() => {
    if (!over) setResultClosed(false)
  }, [over])

  const card = (color: Color) => (
    <PlayerCard
      player={players[color]}
      color={color}
      taken={taken[color]}
      lead={Math.max(0, worth[color] - worth[color === 'w' ? 'b' : 'w'])}
      clock={timed ? game.clock : undefined}
      toMove={!outcome && turn === color}
      disc={pieces[color]}
    />
  )
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

  const mustCapture = moves.length > 0 && moves[0]!.captures.length > 0
  const resultTitle = !outcome
    ? ''
    : outcome.reason === 'aborted' || outcome.reason === 'called_off'
      ? t('draughts.over.aborted')
      : outcome.winner === null
        ? t('draughts.over.draw')
        : perspective === null
          ? t(outcome.winner === 'w' ? 'draughts.over.whiteWins' : 'draughts.over.blackWins')
          : t(outcome.winner === perspective ? 'draughts.over.youWon' : 'draughts.over.youLost')
  const called = outcome?.reason === 'aborted' || outcome?.reason === 'called_off'
  const resultTone: ResultTone = called ? 'neutral' : !outcome || outcome.winner === null ? 'draw' : perspective === null || outcome.winner === perspective ? 'win' : 'loss'

  return (
    // The screen is fixed: exactly as high as the phone, and it never scrolls. Phone: one
    // column (title, board, moves, bar); if the part under the board holds more than fits, that
    // part alone scrolls. Computer: the board takes the height of the window, with the moves
    // and controls in a panel beside it.
    <div className="mx-auto flex h-(--app-h) w-full max-w-xl flex-col gap-2 overflow-hidden px-3 pb-[max(0.5rem,var(--safe-bottom))] pt-1 lg:grid lg:max-w-none lg:grid-cols-[min(calc(var(--app-h)_-_10.5rem),calc(100vw-30rem))_24rem] lg:grid-rows-[auto_minmax(0,1fr)_auto] lg:justify-center lg:gap-x-8 lg:gap-y-3 lg:px-8 lg:py-4">
      <GameHeader title={title} over={over} backTo="/play/draughts" className="lg:col-start-2 lg:row-start-1" />

      <div className="flex shrink-0 flex-col lg:col-start-1 lg:row-span-3 lg:row-start-1 lg:justify-center">
        {/* The board is as large as the screen allows. A draughts board has a hundred squares,
            so on a phone it runs from one edge of the glass to the other (the cards keep their
            margin); only a phone too short to show it whole makes it smaller. */}
        <div className="mx-auto flex w-full max-w-[min(100%,calc(var(--app-h)_-_20.5rem))] flex-col gap-1.5 lg:max-w-full lg:gap-2">
          {notice && (
            <div role="status" className="bg-ink px-3 py-1.5 text-center text-sm font-semibold text-fg">
              {notice}
            </div>
          )}
          {card(top)}
          <div className="max-lg:-mx-3">
          <DraughtsBoard
            board={board}
            orientation={bottom}
            moves={moves}
            lastMove={lastMove}
            onMove={(path) => {
              if (!game.tryMove(path)) feedback('illegal')
            }}
            theme={DRAUGHTS_BOARDS[settings.draughtsBoard]}
            pieces={pieces}
            // Pieces slide whatever the data-saver setting: it costs no data.
            animate
            showNumbers={settings.draughtsNumbers}
            showHints={settings.draughtsHints}
          />
          </div>
          {card(bottom)}
        </div>
      </div>

      {/* What is under the board. If it holds more than fits, it scrolls by itself. */}
      <aside className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto lg:col-start-2 lg:row-start-2 lg:border lg:border-line lg:bg-panel lg:p-4">
        <div className="min-h-6 text-center text-sm font-semibold text-muted" role="status">
          {status ?? (mustCapture ? t('draughts.mustCapture') : <span aria-hidden="true">&nbsp;</span>)}
        </div>

        <MoveList played={played} viewPly={shownPly} onView={view} />
        {chat && (
          <ChatFold open={chatFold.open} onClose={chatFold.hide}>
            {chat}
          </ChatFold>
        )}

        {outcome ? overActionsPinned && overActions : !atLive && <Button onClick={() => setViewPly(null)}>{t('draughts.moves.backToGame')}</Button>}
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
          previousLabel: t('draughts.moves.previous'),
          nextLabel: t('draughts.moves.next'),
        }}
      />

      {dialog === 'menu' && (
        <GameMenu onClose={() => setDialog(null)}>
          {/* Once the game is over: what to do next. A choice made here closes the menu. */}
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
              {game.drawOfferBy === perspective ? t('draughts.actions.drawOffered') : t('draughts.actions.draw')}
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
              {t('draughts.actions.undo')}
            </Button>
          )}
          {/* Someone only watching the game has nothing to resign. */}
          {!outcome && movable !== 'none' && (
            <Button variant="ghost" onClick={() => setDialog('resign')}>
              {canAbort ? t('draughts.actions.abort') : t('draughts.actions.resign')}
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
              {t('draughts.over.showResult')}
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
            {t('draughts.actions.flip')}
          </Button>
        </GameMenu>
      )}

      {dialog === 'resign' && !outcome && perspective && (
        <Sheet title={canAbort ? t('draughts.abort.title') : t('draughts.resign.title')} onClose={() => setDialog(null)}>
          <p className="mt-1 text-muted">{canAbort ? t('draughts.abort.body') : t('draughts.resign.body', { opponent: players[away].name })}</p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)}>
              {t('draughts.resign.cancel')}
            </Button>
            <Button
              className="bg-hibiscus text-white active:bg-hibiscus"
              onClick={() => {
                setDialog(null)
                game.resign(perspective)
              }}
            >
              {canAbort ? t('draughts.abort.confirm') : t('draughts.resign.confirm')}
            </Button>
          </div>
        </Sheet>
      )}

      {/* Only the player who received the offer is asked; the one who made it waits. */}
      {game.drawOfferBy && !outcome && perspective && game.drawOfferBy !== perspective && (
        <Sheet title={t('draughts.drawOffer.title', { name: players[game.drawOfferBy].name })}>
          <p className="mt-1 text-muted">{t('draughts.drawOffer.body')}</p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => game.respondToDraw(false)}>
              {t('draughts.drawOffer.decline')}
            </Button>
            <Button onClick={() => game.respondToDraw(true)}>{t('draughts.drawOffer.accept')}</Button>
          </div>
        </Sheet>
      )}

      {outcome && !resultClosed && (
        <ResultDialog
          title={resultTitle}
          tone={resultTone}
          reason={t(`draughts.over.reason.${outcome.reason}`, { defaultValue: t('draughts.over.reason.other') })}
          onClose={() => setResultClosed(true)}
          closeLabel={t('draughts.over.close')}
        >
          {(tokensChange !== undefined || ratingChange !== undefined) && (
            <ResultStats>
              {ratingChange !== undefined && <ResultStat testId="game-over-rating" label={t('draughts.over.rating')} value={rating ?? ''} change={ratingChange} />}
              {tokensChange !== undefined && <ResultStat testId="game-over-tokens" label={t('draughts.over.tokens')} change={tokensChange} />}
            </ResultStats>
          )}
          <div>{overActions}</div>
        </ResultDialog>
      )}

      {dialog === 'settings' && (
        <Sheet title={t('draughts.settings.title')} onClose={() => setDialog(null)}>
          <div className="mt-4">
            <DraughtsSettings />
          </div>
          <div className="mt-4 divide-y divide-line border-y border-line">
            <Toggle
              label={t('draughts.settings.sound')}
              on={settings.soundOn}
              onChange={(soundOn) => {
                settings.set({ soundOn })
                if (soundOn) feedback('move')
              }}
            />
            <Toggle label={t('draughts.settings.haptics')} on={settings.hapticsOn} onChange={(hapticsOn) => settings.set({ hapticsOn })} />
          </div>
          <Button className="mt-5 w-full" onClick={() => setDialog(null)}>
            {t('draughts.settings.done')}
          </Button>
        </Sheet>
      )}

      {dialog === 'rules' && (
        <Sheet title={t('draughts.rules.title')} onClose={() => setDialog(null)}>
          <ul className="mt-3 flex list-disc flex-col gap-2 ps-5 text-[0.95rem]">
            {(['men', 'capture', 'most', 'kings', 'crown', 'win', 'draw'] as const).map((rule) => (
              <li key={rule}>{t(`draughts.rules.${rule}`)}</li>
            ))}
          </ul>
          <Button className="mt-5 w-full" onClick={() => setDialog(null)}>
            {t('draughts.settings.done')}
          </Button>
        </Sheet>
      )}
    </div>
  )
}
