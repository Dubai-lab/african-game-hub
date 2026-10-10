import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useSettingsStore } from '@/core/settings/settingsStore'
import { Button } from '@/core/ui/Button'
import { type Color, kingSquare, legalTargets, material, needsPromotion, type Promotion, replay, sanFor, type Square, START_FEN } from '../engine/chessLogic'
import { usePieceSet } from '../pieces/usePieceSet'
import { GRADE_STYLE, ReviewPanel } from '../review/ReviewPanel'
import { useGameReview } from '../review/useGameReview'
import { feedback } from '../sound/sounds'
import type { ChessGameController, MoveResult } from '../useLocalChessGame'
import { ChessBoard } from './ChessBoard'
import { GameOverSheet, MoveList, PlayerCard, Sheet } from './panels'
import { SettingsSheet } from './SettingsSheet'
import { BOARD_THEMES } from './themes'

const iconButton =
  'flex size-11 items-center justify-center border-2 border-line bg-panel text-ink focus-visible:outline-2 focus-visible:outline-primary'

function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
      {on ? <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" strokeLinecap="round" /> : <path d="M16 9l5 6M21 9l-5 6" strokeLinecap="round" />}
    </svg>
  )
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path
        d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1"
        strokeLinecap="round"
      />
    </svg>
  )
}

export type TablePlayer = { name: string; flag?: string; rating?: number; /** How the rating moved, once the game is settled. */ ratingChange?: number }

type Props = {
  title: string
  game: ChessGameController
  players: Record<Color, TablePlayer>
  /** Which pieces the person holding the phone may move. */
  movable: Color | 'both' | 'none'
  /** The side this screen belongs to ("You won"), or null when two players share the phone. */
  perspective: Color | null
  timed: boolean
  /** Two players, one phone: draw offers and turning the board to face the mover. */
  passAndPlay: boolean
  /** Online games: draws are offered to, and answered by, the player on the other phone. */
  onlineDraws?: boolean
  /** Online, before both players have moved: leaving simply calls the game off. */
  canAbort?: boolean
  /** Chat with the opponent (online games). */
  chat?: ReactNode
  /** Shown above the board, for example "Reconnecting". */
  notice?: ReactNode
  /**
   * What the player can do once the game is over. Online games pass their own (new opponent,
   * rematch offer); without it the table offers "Rematch" and "New game" itself.
   */
  overActions?: ReactNode
  /** Online games, once settled: shown on the result screen. */
  tokensChange?: number
  rating?: number
  ratingChange?: number
  /** Practice only: take the last move back. */
  onUndo?: () => void
  canUndo?: boolean
  /** A line under the board, for example "The computer is thinking". */
  status?: ReactNode
  onRematch: () => void
  onNewGame?: () => void
}

/** The whole chess screen: both player cards, the board, the move list and the controls. */
export function GameTable({
  title,
  game,
  players,
  movable,
  perspective,
  timed,
  passAndPlay,
  onlineDraws,
  canAbort,
  notice,
  chat,
  overActions,
  tokensChange,
  rating,
  ratingChange,
  onUndo,
  canUndo,
  status,
  onRematch,
  onNewGame,
}: Props) {
  const { t } = useTranslation()
  const settings = useSettingsStore()
  const pieceSet = usePieceSet(settings.chessPieceSet)

  const [flipped, setFlipped] = useState(false)
  const [autoFlip, setAutoFlip] = useState(false)
  // Null means "follow the game"; a number means the player is looking back at that ply.
  const [viewPly, setViewPly] = useState<number | null>(null)
  const [dialog, setDialog] = useState<'resign' | 'settings' | null>(null)
  const [reviewing, setReviewing] = useState(false)
  // The result can be put aside to look at the board, and brought back.
  const [resultClosed, setResultClosed] = useState(false)
  // Once a game is over, the player may try moves of their own from any position in it: "what
  // if I had played this instead?". `ply` is where they left the real game, `sans` what they
  // have tried since. Nothing here touches the game itself, which is finished and recorded.
  const [trial, setTrial] = useState<{ ply: number; sans: string[] } | null>(null)

  const { chess, played, turn, outcome } = game
  const livePly = played.length
  const shownPly = Math.min(viewPly ?? livePly, livePly)
  const atLive = shownPly === livePly

  // The line being tried, played through from the start of the real game (so that repetition
  // and castling rights are right), or null when the player is looking at the game itself.
  const tried = useMemo(() => {
    if (!trial) return null
    try {
      return replay([...played.slice(0, trial.ply).map((move) => move.san), ...trial.sans])
    } catch {
      return null
    }
  }, [trial, played])

  const shown = useMemo(() => {
    if (tried) {
      const last = tried.played.at(-1) ?? null
      const fen = tried.chess.fen()
      return {
        fen,
        position: tried.chess,
        turn: tried.chess.turn(),
        lastMove: last && { from: last.from, to: last.to },
        checkSquare: tried.chess.isCheck() ? kingSquare(tried.chess, tried.chess.turn()) : null,
        material: material(fen),
      }
    }
    const fen = shownPly === 0 ? START_FEN : played[shownPly - 1]!.fenAfter
    // The position with its history, which is what makes the list of legal moves exact.
    const position = atLive ? chess : replay(played.slice(0, shownPly).map((move) => move.san)).chess
    const last = shownPly > 0 ? played[shownPly - 1]! : null
    return {
      fen,
      position,
      turn: position.turn(),
      lastMove: last && { from: last.from, to: last.to },
      checkSquare: position.isCheck() ? kingSquare(position, position.turn()) : null,
      material: material(fen),
    }
  }, [shownPly, played, chess, atLive, tried])

  const targetsFor = useCallback((square: Square) => legalTargets(shown.position, square), [shown.position])

  // Game review. The engine is only ever started for a game that is over, and by itself only
  // when the player has not asked to save data (it is a download the first time).
  const over = outcome !== null
  useEffect(() => {
    if (!over) setResultClosed(false)
  }, [over])
  const reviewable = over && livePly >= 2
  const review = useGameReview(played, reviewable)
  const startReview = review.start
  useEffect(() => {
    if (reviewable && !settings.dataSaver) startReview()
  }, [reviewable, settings.dataSaver, startReview])
  const grades = useMemo(() => review.moves.map((move) => move.grade), [review.moves])
  // While the player is trying their own moves, the notes on the real game step aside.
  const shownReview = reviewing && !trial && shownPly > 0 ? review.moves[shownPly - 1] : undefined

  /** A move of the player's own on a finished game: it starts, or adds to, the line being tried. */
  const tryOwnMove = useCallback(
    (from: Square, to: Square, promotion?: Promotion): MoveResult => {
      const position = shown.position
      if (!promotion && needsPromotion(position, from, to)) return 'promotion'
      const san = sanFor(position, from, to, promotion)
      if (!san) return 'illegal'
      const line = trial ? { ply: trial.ply, sans: [...trial.sans, san] } : { ply: shownPly, sans: [san] }
      setTrial(line)
      const move = replay([...played.slice(0, line.ply).map((m) => m.san), ...line.sans]).played.at(-1)!
      feedback(move.check ? 'check' : move.kind)
      return 'ok'
    },
    [shown.position, trial, shownPly, played],
  )
  const takeBackTried = () => setTrial((line) => (line && line.sans.length > 1 ? { ...line, sans: line.sans.slice(0, -1) } : null))
  // A new game on the same screen starts clean.
  useEffect(() => {
    if (!over) setTrial(null)
  }, [over])

  // Stepping through a finished game is heard as well as seen: each move makes the sound it
  // made when it was played. (During the game itself, moves sound as they happen.)
  const heardPly = useRef(shownPly)
  useEffect(() => {
    const before = heardPly.current
    heardPly.current = shownPly
    if (!over || trial || before === shownPly) return
    // One step forward: the move just arrived at. One step back: the move just taken off the
    // board. A jump: the move the board now shows.
    const step = Math.abs(shownPly - before) === 1
    const move = played[(step && shownPly < before ? before : shownPly) - 1]
    if (move) feedback(shownPly > before && move.check ? 'check' : move.kind)
  }, [shownPly, over, trial, played])

  const home: Color = perspective ?? 'w'
  const away: Color = home === 'w' ? 'b' : 'w'
  const bottom: Color = passAndPlay && autoFlip && !outcome ? turn : flipped ? away : home
  const top: Color = bottom === 'w' ? 'b' : 'w'
  // In a two-player game the side to move resigns; against the computer it is always the player.
  const resigner: Color = perspective ?? turn
  const sideName = (color: Color) => t(color === 'w' ? 'chess.white' : 'chess.black')

  const card = (color: Color) =>
    pieceSet && (
      <PlayerCard
        name={players[color].name}
        flag={players[color].flag}
        rating={players[color].rating}
        ratingChange={outcome ? players[color].ratingChange : undefined}
        color={color}
        captured={shown.material.captured[color]}
        lead={shown.material.lead[color]}
        clock={timed ? game.clock : undefined}
        toMove={!outcome && turn === color}
        pieceSet={pieceSet}
      />
    )

  const rematch = () => {
    setViewPly(null)
    setReviewing(false)
    setResultClosed(false)
    onRematch()
  }
  // Choosing a move of the real game (or Previous / Next) leaves the line being tried.
  const view = (ply: number) => {
    setTrial(null)
    setViewPly(ply >= livePly ? null : Math.max(0, ply))
  }
  // Review starts from the first move, the way a game is gone over.
  const openReview = () => {
    setReviewing(true)
    setViewPly(Math.min(1, livePly))
    review.start()
  }

  const actions = overActions ?? (
    <div className="grid grid-cols-2 gap-2">
      <Button variant="ghost" onClick={rematch} className={onNewGame ? '' : 'col-span-2'}>
        {t('chess.over.rematch')}
      </Button>
      {onNewGame && (
        <Button variant="ghost" onClick={onNewGame}>
          {t('chess.over.newGame')}
        </Button>
      )}
    </div>
  )

  // Computer keyboard: the arrow keys step through the game.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      // In a line of the player's own, the arrows first lead back to the real game.
      setTrial(null)
      if (event.key === 'ArrowLeft') setViewPly((current) => Math.max(0, (current ?? livePly) - 1))
      if (event.key === 'ArrowRight') setViewPly((current) => (current === null || current + 1 >= livePly ? null : current + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [livePly])

  return (
    // Phone: one column (bar, board, moves, buttons). Computer: the board takes the full height
    // of the window (or the width left beside the panel, whichever is smaller), the moves and
    // controls sit in a panel right next to it, and the pair is centred.
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 lg:grid lg:h-dvh lg:max-w-none lg:grid-cols-[min(calc(100dvh-10.5rem),calc(100vw-30rem))_24rem] lg:grid-rows-[auto_minmax(0,1fr)] lg:justify-center lg:gap-x-8 lg:gap-y-3 lg:px-8 lg:py-4">
      <header className="flex items-center justify-between gap-2 lg:col-start-2 lg:row-start-1">
        <Link to="/lobby" className="flex min-h-11 items-center font-semibold text-primary underline underline-offset-4">
          {t('chess.local.back')}
        </Link>
        <p className="truncate font-display text-lg font-extrabold tabular-nums text-primary">{title}</p>
        <div className="flex gap-2">
          <button
            type="button"
            className={iconButton}
            aria-pressed={settings.soundOn}
            aria-label={t(settings.soundOn ? 'chess.muteOn' : 'chess.muteOff')}
            onClick={() => settings.set({ soundOn: !settings.soundOn })}
          >
            <SoundIcon on={settings.soundOn} />
          </button>
          <button type="button" className={iconButton} aria-label={t('chess.settings.title')} onClick={() => setDialog('settings')}>
            <GearIcon />
          </button>
        </div>
      </header>

      <div className="flex flex-col lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:justify-center">
        {/* The board is as large as the window allows: limited by the width on a phone, by the
            height on a computer. The player cards line up with its edges. */}
        <div className="mx-auto flex w-full max-w-[min(100%,calc(100dvh-19.5rem))] flex-col gap-2 lg:max-w-full">
          {notice && (
            <div role="status" className="bg-ink px-3 py-1.5 text-center text-sm font-semibold text-surface">
              {notice}
            </div>
          )}

          {card(top)}

          {pieceSet ? (
            <ChessBoard
              fen={shown.fen}
              orientation={bottom === 'w' ? 'white' : 'black'}
              interactive={over ? true : atLive}
              turn={shown.turn}
              movable={over ? 'both' : movable}
              lastMove={shown.lastMove}
              checkSquare={shown.checkSquare}
              targetsFor={targetsFor}
              onMove={over ? tryOwnMove : game.tryMove}
              theme={BOARD_THEMES[settings.chessBoardTheme]}
              pieceSet={pieceSet}
              animate={!settings.dataSaver}
              premoves={settings.chessPremoves && !passAndPlay && !over}
              tint={shownReview && shown.lastMove ? { square: shown.lastMove.to, color: GRADE_STYLE[shownReview.grade].color } : null}
              arrows={shownReview?.better ? [{ from: shownReview.better.from, to: shownReview.better.to, color: GRADE_STYLE.best.color }] : undefined}
            />
          ) : (
            <div className="aspect-square w-full animate-pulse bg-line/70" aria-hidden="true" />
          )}

          {card(bottom)}
        </div>
      </div>

      {/* On a computer the panel scrolls by itself if a short window cannot hold everything. */}
      <aside className="flex flex-col gap-2 lg:col-start-2 lg:row-start-2 lg:min-h-0 lg:overflow-y-auto lg:border-2 lg:border-line lg:bg-panel lg:p-4">
        {status && (
          <div className="min-h-6 text-center text-sm font-semibold text-muted" role="status">
            {status}
          </div>
        )}

        {/* Reviewing a finished game, top to bottom: the move on the board and what the engine
            thinks of it; the moves, with Previous and Next; then the whole game in numbers. */}
        {reviewing && reviewable && (
          <ReviewPanel part="now" review={review} played={played} shownPly={shownPly} names={{ w: players.w.name, b: players.b.name }} />
        )}

        {over && !trial && livePly > 0 && <p className="text-center text-sm text-muted">{t('chess.trial.hint')}</p>}

        {/* The player's own line, when they are trying one: what they have played, and the way back. */}
        {trial && tried && (
          <div className="flex flex-col gap-2 border-2 border-brand bg-brand/15 p-3" data-testid="trial" role="status">
            <p className="text-sm font-bold">{t('chess.trial.title')}</p>
            <p className="font-semibold tabular-nums" data-testid="trial-line">
              {tried.played.slice(trial.ply).map((move) => `${move.color === 'w' ? `${(move.ply + 1) / 2}. ` : move.ply === trial.ply + 1 ? `${move.ply / 2}… ` : ''}${move.san}`).join(' ')}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={takeBackTried}>
                {t('chess.trial.takeBack')}
              </Button>
              <Button onClick={() => setTrial(null)} data-testid="trial-back">
                {t('chess.trial.back')}
              </Button>
            </div>
          </div>
        )}

        <MoveList played={played} viewPly={trial ? trial.ply : shownPly} onView={view} grades={reviewing ? grades : undefined} />

        {reviewing && reviewable && (
          <ReviewPanel part="summary" review={review} played={played} shownPly={shownPly} names={{ w: players.w.name, b: players.b.name }} />
        )}

        {/* During a review the chat folds away to leave room; one tap opens it. */}
        {chat && reviewing ? (
          <details className="shrink-0">
            <summary className="min-h-9 cursor-pointer text-sm font-semibold text-primary underline underline-offset-4">{t('chess.review.showChat')}</summary>
            <div className="mt-2">{chat}</div>
          </details>
        ) : (
          chat
        )}

        {outcome ? (
          <>
            {/* With the result put aside: the way into the review, and the way back to the result. */}
            {!reviewing && resultClosed && (
              <div className="grid auto-cols-fr grid-flow-col gap-2">
                {reviewable && (
                  <Button onClick={openReview} data-testid="open-review">
                    <span aria-hidden="true" className="me-1.5">★</span>
                    {t('chess.review.open')}
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setResultClosed(false)} data-testid="show-result">
                  {t('chess.over.showResult')}
                </Button>
              </div>
            )}
            {actions}
          </>
        ) : !atLive ? (
          <Button onClick={() => setViewPly(null)}>{t('chess.moves.backToGame')}</Button>
        ) : (
          <div className="grid auto-cols-fr grid-flow-col gap-2 *:px-1 *:text-sm">
            {(passAndPlay || onlineDraws) && (
              <Button
                variant="ghost"
                onClick={() => game.offerDraw(perspective ?? turn)}
                disabled={livePly < 2 || game.drawOfferBy !== null}
              >
                {onlineDraws && perspective && game.drawOfferBy === perspective ? t('chess.actions.drawOffered') : t('chess.actions.draw')}
              </Button>
            )}
            {onUndo && (
              <Button variant="ghost" onClick={onUndo} disabled={!canUndo}>
                {t('chess.actions.undo')}
              </Button>
            )}
            {/* Someone only watching the game has nothing to resign. */}
            {movable !== 'none' && (
              <Button variant="ghost" onClick={() => setDialog('resign')}>
                {canAbort ? t('chess.actions.abort') : t('chess.actions.resign')}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setFlipped((f) => !f)} disabled={passAndPlay && autoFlip}>
              {t('chess.actions.flip')}
            </Button>
          </div>
        )}
      </aside>

      {dialog === 'resign' && !outcome && (
        <Sheet
          title={canAbort ? t('chess.abort.title') : perspective ? t('chess.resign.titleYou') : t('chess.resign.title', { side: sideName(resigner) })}
          onClose={() => setDialog(null)}
        >
          <p className="mt-1 text-muted">
            {canAbort
              ? t('chess.abort.body')
              : perspective
              ? t('chess.resign.bodyYou', { opponent: players[away].name })
              : t('chess.resign.body', { side: sideName(resigner === 'w' ? 'b' : 'w') })}
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)}>
              {t('chess.resign.cancel')}
            </Button>
            <Button
              className="bg-hibiscus text-white active:bg-hibiscus"
              onClick={() => {
                setDialog(null)
                game.resign(resigner)
              }}
            >
              {canAbort ? t('chess.abort.confirm') : t('chess.resign.confirm')}
            </Button>
          </div>
        </Sheet>
      )}

      {/* Online, only the player who received the offer is asked; the one who made it waits. */}
      {game.drawOfferBy && !outcome && !(onlineDraws && game.drawOfferBy === perspective) && (
        <Sheet title={t('chess.drawOffer.title', { side: onlineDraws ? players[game.drawOfferBy].name : sideName(game.drawOfferBy) })}>
          <p className="mt-1 text-muted">
            {onlineDraws ? t('chess.drawOffer.bodyOnline') : t('chess.drawOffer.body', { side: sideName(game.drawOfferBy === 'w' ? 'b' : 'w') })}
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => game.respondToDraw(false)}>
              {t('chess.drawOffer.decline')}
            </Button>
            <Button onClick={() => game.respondToDraw(true)}>{t('chess.drawOffer.accept')}</Button>
          </div>
        </Sheet>
      )}

      {outcome && !reviewing && !resultClosed && (
        <GameOverSheet
          outcome={outcome}
          perspective={perspective}
          tokensChange={tokensChange}
          rating={rating}
          ratingChange={ratingChange}
          review={reviewable ? review : undefined}
          actions={actions}
          onReview={openReview}
          onClose={() => setResultClosed(true)}
        />
      )}

      {dialog === 'settings' && (
        <SettingsSheet onClose={() => setDialog(null)} autoFlip={passAndPlay ? { on: autoFlip, onChange: setAutoFlip } : undefined} />
      )}
    </div>
  )
}
