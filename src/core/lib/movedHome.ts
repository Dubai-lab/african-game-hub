// The hub moved from its first address to its own domain.
//
// A browser that asks the old address is sent on by the server. A copy of the app installed
// from the old address is not: it opens from what the phone has stored and never asks the
// server for the page, so it would stay at the old address for good. This is the app sending
// itself on instead. It runs before anything is drawn.
//
// A player who was signed in at the old address signs in once more at the new one: a browser
// keeps what it remembers separately for each address.

/** Old address -> where the hub lives now. */
const MOVED: Record<string, string> = {
  'd2xirivzgoo9lw.cloudfront.net': 'https://africangamehub.com',
  'www.africangamehub.com': 'https://africangamehub.com',
}

type Place = Pick<Location, 'hostname' | 'pathname' | 'search' | 'hash'>

/** The same page at the hub's new address, or null when this is not an old address. */
export function newHomeFor(place: Place): string | null {
  const home = MOVED[place.hostname.toLowerCase()]
  return home ? `${home}${place.pathname}${place.search}${place.hash}` : null
}

/** Leaves for the new address when the app finds itself at an old one. True when it is leaving. */
export function leaveOldHome(): boolean {
  const home = newHomeFor(window.location)
  if (!home) return false
  // replace, not assign: Back must not bring the player to the old address again.
  window.location.replace(home)
  return true
}
