// The Android and iPhone apps (see mobile/) are a native shell that opens this site. Nearly
// everything is the same inside the shell as in a browser; this file holds the little that is
// not.
//
// The shell adds its own name and version to the browser's description of itself, and puts a
// `Capacitor` object on the page through which the page can speak to the phone. Nothing is
// added to the site's download for it.

type BackEvent = { canGoBack: boolean }
type AppPlugin = {
  addListener: (event: 'backButton', listener: (event: BackEvent) => void) => unknown
  minimizeApp?: () => Promise<void>
  exitApp?: () => Promise<void>
}
type BarsPlugin = {
  hide?: (options?: { bar?: 'StatusBar' | 'NavigationBar' }) => Promise<void>
  show?: (options?: { bar?: 'StatusBar' | 'NavigationBar' }) => Promise<void>
  setStyle?: (options: { style: 'DARK' | 'LIGHT' | 'DEFAULT' }) => Promise<void>
}
type NativeWindow = Window & { Capacitor?: { Plugins?: { App?: AppPlugin; SystemBars?: BarsPlugin } } }

/** The shell's version, as [major, minor], or null in a browser. */
export function shellVersion(userAgent: string = navigator.userAgent): [number, number] | null {
  const found = /\bAfricanGameHubApp\/(\d+)\.(\d+)/.exec(userAgent)
  return found ? [Number(found[1]), Number(found[2])] : null
}

/** True inside the Android or iPhone app. */
export function isNativeApp(userAgent: string = navigator.userAgent): boolean {
  return shellVersion(userAgent) !== null
}

/**
 * Who keeps the page clear of the phone's status bar and notch: the shell, or the page?
 *
 *  - On Android the shell does (it draws the page between the bars).
 *  - On an iPhone the first shell (1.0) did too. It did so by pushing the page down inside the
 *    phone's own scrolling frame, and on that frame a screen drawn turned (pool) was touched
 *    in the wrong place: the cue could not be pulled and the far pockets could not be called.
 *    From 1.1 the iPhone shell gives the page the whole glass, as a browser does, and the
 *    page keeps itself clear (see --safe-top and --app-h in index.css).
 */
export function shellKeepsPageClear(userAgent: string = navigator.userAgent): boolean {
  const version = shellVersion(userAgent)
  if (!version) return false
  const iphone = /iPhone|iPad|iPod/.test(userAgent)
  return !iphone || (version[0] === 1 && version[1] === 0)
}

const plugins = () => (window as NativeWindow).Capacitor?.Plugins

/** The pages with nothing behind them: Back on these leaves the app. */
const FRONT_PAGES = new Set(['/', '/lobby', '/login'])

/** What the phone's Back button does on a page: step back through the app, or leave it. */
export function backAction(pathname: string, canGoBack: boolean): 'back' | 'leave' {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return canGoBack && !FRONT_PAGES.has(path) ? 'back' : 'leave'
}

/** Run once, before anything is drawn. Does nothing in a browser. */
export function startNativeApp() {
  if (!isNativeApp()) return
  // An app, not a website in a frame: no scroll bars, no bounce (see index.css).
  document.documentElement.classList.add('native-app')
  // Where the shell keeps the page clear of the notch and the home bar itself, the page must
  // not leave the room a second time (see index.css).
  if (shellKeepsPageClear()) document.documentElement.classList.add('in-app')
  // Where the page has the whole glass, the clock and battery are read on the page's own
  // light ground: dark, whatever the phone's own light or dark setting.
  else void plugins()?.SystemBars?.setStyle?.({ style: 'LIGHT' })?.catch(() => {})

  // Android's Back button. Without this it would do nothing on the app's first page, and on the
  // lobby it would walk back through pages the player has already left. Going back through the
  // browser's own history keeps every in-app rule that hangs on it (the "Leave this game?"
  // question on a live match, closing an open sheet).
  const app = plugins()?.App
  if (!app) return
  try {
    app.addListener('backButton', ({ canGoBack }) => {
      if (backAction(window.location.pathname, canGoBack) === 'back') window.history.back()
      // Put the app away without closing it: a player who comes back finds their page.
      else void (app.minimizeApp ?? app.exitApp)?.call(app)?.catch(() => {})
    })
  } catch {
    // An older shell without the Back button bridge: the phone's own behaviour stays.
  }
}

/**
 * While a game is being played the app is only the game: the phone's clock, signal and battery
 * are put away, and come back when the player leaves the game. Does nothing in a browser.
 */
export function setPlayingFullScreen(playing: boolean) {
  if (!isNativeApp()) return
  const bars = plugins()?.SystemBars
  try {
    void (playing ? bars?.hide : bars?.show)?.call(bars, { bar: 'StatusBar' })?.catch(() => {})
  } catch {
    // A shell without it: the status bar simply stays.
  }
}
