import type { CapacitorConfig } from '@capacitor/cli'

// The Android and iPhone apps are a native shell around the hub's own site: the app opens the
// live site, so a player in the app and a player in a browser are on the same version, and an
// update to the site reaches the apps without a new release in the stores.
//
// AGH_APP_URL is for testing the shell against another copy of the site (never for a release).
const site = process.env.AGH_APP_URL ?? 'https://africangamehub.com'

const config: CapacitorConfig = {
  appId: 'com.africangamehub.app',
  appName: 'African Game Hub',
  // What the shell itself carries: only the page shown when the site cannot be reached.
  webDir: 'www',
  // The site can tell it is inside the app (see src/core/lib/nativeApp.ts in the web app).
  // The number is the shell's own version: the site behaves a little differently for each
  // (see shellKeepsPageClear in nativeApp.ts). Raise it whenever the shell changes how it
  // shows the page.
  appendUserAgent: 'AfricanGameHubApp/1.1',
  backgroundColor: '#1f2a7a',
  server: {
    // Straight to the lobby: a signed-out player is sent to the log-in page from there. The
    // landing page is for visitors arriving from the web.
    url: `${site}/lobby`,
    // Shown instead of a browser error when the phone is offline or the site is unreachable.
    errorPath: 'offline.html',
    // Anything outside the site (a link in the policies, an email address) opens in the phone's
    // browser or mail app, never inside the app.
    allowNavigation: [new URL(site).hostname],
  },
  android: {
    // Plain http is never used; the site is https only.
    allowMixedContent: false,
  },
  ios: {
    // The page is given the whole glass, as in a browser, and keeps itself clear of the notch
    // and the home bar (--safe-top and --app-h in the site's index.css). The first shell let
    // the phone push the page down instead; on that, a screen the game draws turned (pool) was
    // touched in the wrong place.
    contentInset: 'never',
    // Pages are not zoomed or previewed like documents in a browser.
    allowsLinkPreview: false,
  },
  plugins: {
    // Android: the app itself keeps the page clear of the status bar, the camera cut-out and
    // the navigation bar (MainActivity.java), the same way on every phone. The bars are the
    // hub's indigo, with light icons.
    SystemBars: {
      insetsHandling: 'disable',
      style: 'DARK',
    },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 800,
      backgroundColor: '#1f2a7a',
      showSpinner: false,
    },
  },
}

export default config
