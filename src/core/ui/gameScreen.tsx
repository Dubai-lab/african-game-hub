// The parts every game's playing screen is put together from, so that a game looks and behaves
// the same whichever game it is:
//
//  - the screen is fixed in place: nothing scrolls or bounces while a game is being played;
//  - there is no way out of a game at the top of the screen while it is on (leaving is a
//    decision, taken from the menu), and an arrow back to the game's own page once it is over;
//  - one bar at the bottom: the menu, the chat, the review, and the arrows through the moves.
//    Everything else a player can do is in the menu.
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { setPlayingFullScreen } from '@/core/lib/nativeApp'
import { useSettingsStore } from '@/core/settings/settingsStore'
import { Button } from './Button'

/**
 * Fixes the page in place for as long as the screen that calls this is shown: no scrolling, and
 * no rubber-band bounce on an iPhone. In the phone apps it also puts the phone's status bar away. What does not fit on the screen scrolls inside its own
 * part of it (see the game tables), never the page.
 */
export function useLockedScreen() {
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('screen-locked')
    window.scrollTo(0, 0)
    // In the phone apps the game takes the whole screen: the clock and battery are put away.
    setPlayingFullScreen(true)
    return () => {
      root.classList.remove('screen-locked')
      setPlayingFullScreen(false)
    }
  }, [])
}

const square = 'flex size-11 shrink-0 items-center justify-center border border-line bg-panel text-fg focus-visible:outline-2 focus-visible:outline-accent'

/** The top of a playing screen: the title, and (once the game is over) the arrow back. */
export function GameHeader({ title, over, backTo, className = '', children }: { title: string; over: boolean; backTo: string; className?: string; children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <header className={`flex shrink-0 items-center gap-2 ${className}`}>
      {over ? (
        <Link to={backTo} className={square} aria-label={t('gameMenu.back')} data-testid="game-back">
          <span aria-hidden="true" className="text-2xl font-bold leading-none">
            ‹
          </span>
        </Link>
      ) : (
        <span className="size-11 shrink-0" aria-hidden="true" />
      )}
      <p className="min-w-0 flex-1 truncate text-center font-display text-lg font-extrabold tabular-nums text-accent">{title}</p>
      {children ?? <span className="size-11 shrink-0" aria-hidden="true" />}
    </header>
  )
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  )
}

/** A speech bubble; crossed out when there is nobody left to talk to. */
function ChatIcon({ closed }: { closed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="currentColor" opacity={closed ? 0.45 : 1} />
      {closed && <path d="M8.5 7l7 7M15.5 7l-7 7" stroke="var(--color-panel, #fff)" strokeWidth="2.4" strokeLinecap="round" fill="none" />}
    </svg>
  )
}

export function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
      {on ? <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" strokeLinecap="round" /> : <path d="M16 9l5 6M21 9l-5 6" strokeLinecap="round" />}
    </svg>
  )
}

export function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" strokeLinecap="round" />
    </svg>
  )
}

const barButton = 'flex h-12 w-full items-center justify-center border border-line bg-panel text-fg disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent'

type BarProps = {
  onMenu: () => void
  /** The chat button; absent in a game with nobody to talk to (practice, one phone). */
  chat?: { closed: boolean; news: boolean; onOpen: () => void } | null
  /** The review button, shown once there is a finished game to go through. */
  review?: { label: string; onOpen: () => void } | null
  /** The arrows that step back and forward through the moves; absent in a game without them. */
  steps?: { atStart: boolean; atEnd: boolean; onPrevious: () => void; onNext: () => void; previousLabel: string; nextLabel: string } | null
  className?: string
}

/** The bar at the bottom of a playing screen. */
export function GameBar({ onMenu, chat, review, steps, className = '' }: BarProps) {
  const { t } = useTranslation()
  return (
    <nav className={`grid shrink-0 grid-cols-5 items-center gap-2 ${className}`} aria-label={t('gameMenu.bar')}>
      <button type="button" className={barButton} aria-label={t('gameMenu.open')} aria-haspopup="dialog" onClick={onMenu} data-testid="game-menu">
        <MenuIcon />
      </button>
      {chat ? (
        // On a computer the chat is always in the panel beside the board; the button is for phones.
        <button
          type="button"
          className={`${barButton} relative lg:invisible`}
          aria-label={t(chat.closed ? 'gameMenu.chatClosed' : chat.news ? 'gameMenu.chatNew' : 'gameMenu.chat')}
          onClick={chat.onOpen}
          data-testid="game-chat"
          data-closed={chat.closed}
          data-news={chat.news}
        >
          <ChatIcon closed={chat.closed} />
          {chat.news && !chat.closed && <span className="absolute end-1.5 top-1.5 size-2.5 rounded-full bg-hibiscus" aria-hidden="true" />}
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
      {review ? (
        <button type="button" className="flex h-12 w-full items-center justify-center border border-edge bg-brand text-brand-ink focus-visible:outline-2 focus-visible:outline-accent" aria-label={review.label} onClick={review.onOpen} data-testid="open-review">
          <span aria-hidden="true" className="text-2xl leading-none">
            ★
          </span>
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
      {steps ? (
        <>
          <button type="button" className={barButton} disabled={steps.atStart} onClick={steps.onPrevious} aria-label={steps.previousLabel}>
            <span aria-hidden="true" className="text-2xl font-bold leading-none">
              ‹
            </span>
          </button>
          <button type="button" className={barButton} disabled={steps.atEnd} onClick={steps.onNext} aria-label={steps.nextLabel}>
            <span aria-hidden="true" className="text-2xl font-bold leading-none">
              ›
            </span>
          </button>
        </>
      ) : (
        <>
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </>
      )}
    </nav>
  )
}

/**
 * The menu: everything a player can do in the game that is not a move. The game puts its own
 * choices in (draw, resign...); the sound switch and Cancel are the same in every game.
 */
export function GameMenu({ onClose, children }: { onClose: () => void; children?: ReactNode }) {
  const { t } = useTranslation()
  const settings = useSettingsStore()
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/55 sm:items-center" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('gameMenu.title')}
        onClick={(event) => event.stopPropagation()}
        className="max-h-full w-full max-w-md overflow-y-auto glass rounded-t-3xl border-t border-line px-5 pb-[max(1.25rem,var(--safe-bottom))] pt-5 sm:rounded-3xl sm:border"
      >
        <h2 className="font-display text-2xl font-extrabold text-accent">{t('gameMenu.title')}</h2>
        <div className="mt-3 flex flex-col gap-2" data-testid="game-menu-list">
          {children}
          <Button variant="ghost" aria-pressed={settings.soundOn} onClick={() => settings.set({ soundOn: !settings.soundOn })} data-testid="menu-sound">
            <span className="me-2 inline-flex align-middle">
              <SoundIcon on={settings.soundOn} />
            </span>
            {t(settings.soundOn ? 'gameMenu.soundOff' : 'gameMenu.soundOn')}
          </Button>
          <Button onClick={onClose} className="mt-2">
            {t('gameMenu.cancel')}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * The chat. On a computer it sits in the panel. On a phone it is folded away until the chat
 * button is pressed, then opens over the board; what the opponent says still pops up over the
 * game while it is folded.
 */
export function ChatFold({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div
      className={open ? 'max-lg:fixed max-lg:inset-0 max-lg:z-40 max-lg:flex max-lg:items-end max-lg:justify-center max-lg:bg-ink/55' : 'max-lg:[&_section>*:not([data-testid=chat-pop])]:hidden'}
      onClick={onClose}
      role="presentation"
    >
      <div
        // Open, on a phone: most of the screen, so the conversation has room.
        className={open ? 'max-lg:flex max-lg:h-[82dvh] max-lg:w-full max-lg:max-w-md max-lg:flex-col max-lg:border-t-4 max-lg:border-brand max-lg:bg-panel max-lg:px-4 max-lg:pb-[max(0.75rem,var(--safe-bottom))] max-lg:pt-2' : ''}
        onClick={(event) => event.stopPropagation()}
        data-testid="chat-sheet"
        data-open={open}
      >
        {open && (
          <div className="mb-1 grid shrink-0 grid-cols-[2.75rem_1fr_2.75rem] items-center lg:hidden">
            <button type="button" onClick={onClose} aria-label={t('common.close')} className="flex size-11 items-center justify-center text-2xl font-bold leading-none" data-testid="chat-close">
              <span aria-hidden="true">×</span>
            </button>
            <p className="text-center font-display text-lg font-extrabold text-accent">{t('chat.title')}</p>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

/**
 * What the chat button needs to know: whether the chat is open, and whether the opponent has
 * said something since it was last looked at. The number given goes up by one each time they speak.
 */
export function useChatFold(heard: number, sent = 0) {
  const [open, setOpen] = useState(false)
  const [news, setNews] = useState(false)
  const before = useRef(heard)
  // A quick message has been sent: the chat is put away, back to the game.
  const sentBefore = useRef(sent)
  useEffect(() => {
    if (sent === sentBefore.current) return
    sentBefore.current = sent
    setOpen(false)
  }, [sent])
  useEffect(() => {
    if (heard === before.current) return
    before.current = heard
    if (!open) setNews(true)
  }, [heard, open])
  return {
    open,
    news,
    show: () => {
      setNews(false)
      setOpen(true)
    },
    hide: () => setOpen(false),
  }
}
