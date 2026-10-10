// The Android and iPhone apps (see mobile/) are a native shell that opens this site. Nearly
// everything is the same inside the shell as in a browser; this file holds the little that is
// not.
//
// The shell adds its own name to the browser's description of itself, and puts a `Capacitor`
// object on the page through which the page can speak to the phone. Nothing is added to the
// site's download for it.

type BackEvent = { canGoBack: boolean }
type AppPlugin = {
  addListener: (event: 'backButton', listener: (event: BackEvent) => void) => unknown
  minimizeApp?: () => Promise<void>
  exitApp?: () => Promise<void>
}
type NativeWindow = Window & { Capacitor?: { Plugins?: { App?: AppPlugin } } }

/** True inside the Android or iPhone app. */
export function isNativeApp(userAgent: string = navigator.userAgent): boolean {
  return /\bAfricanGameHubApp\//.test(userAgent)
}

/** The pages with nothing behind them: Back on these leaves the app. */
const FRONT_PAGES = new Set(['/', '/lobby', '/login'])

/** What the phone's Back button does on a page: step back through the app, or leave it. */
export function backAction(pathname: string, canGoBack: boolean): 'back' | 'leave' {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return canGoBack && !FRONT_PAGES.has(path) ? 'back' : 'leave'
}

/**
 * Android's Back button. Without this it would do nothing on the app's first page, and on the
 * lobby it would walk back through pages the player has already left. Going back through the
 * browser's own history keeps every in-app rule that hangs on it (the "Leave this game?"
 * question on a live match, closing an open sheet).
 */
export function startNativeApp() {
  if (!isNativeApp()) return
  const app = (window as NativeWindow).Capacitor?.Plugins?.App
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
