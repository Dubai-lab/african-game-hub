import type { FunctionReply } from './functions'
import { supabase } from './supabase'

// The app's line to the game server: one open connection for the game on screen, so a move
// reaches the opponent in a single short hop.
//
// It is an extra, never a requirement. When no game server is configured, when it cannot be
// reached, or while it is restarting, `ready` is false and the game is played through the
// Edge Functions exactly as before. Nothing the server sends is trusted beyond what the
// database would say: the app still loads the game from the database, and still listens to it.

const SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL as string | undefined
const REPLY_WITHIN_MS = 8000
const RETRY_MS = [1000, 2000, 4000, 8000, 15_000]

export type GameLink = {
  /** True while a move can be sent this way. */
  readonly ready: boolean
  /** Sends a request and resolves with the server's answer. Rejects if no answer comes. */
  request: <T>(message: Record<string, unknown>) => Promise<T>
  /** Sends a message that wants no answer (a real-time game's buttons). False when not connected. */
  send: (message: Record<string, unknown>) => boolean
  close: () => void
}

type Handlers = {
  /** Anything the server sends that is not the answer to a request. */
  onMessage: (message: { t: string } & Record<string, unknown>) => void
  /** Connected and admitted: `ply` is how many moves the server holds. */
  onReady: (ply: number) => void
}

/** Whether this build of the app knows of a game server at all. */
export const gameServerConfigured = Boolean(SERVER_URL)

/** Opens (and keeps open) a connection for one match. Null when there is no game server. */
export function openGameLink(game: string, matchId: string, handlers: Handlers): GameLink | null {
  if (!SERVER_URL || typeof WebSocket === 'undefined') return null

  let socket: WebSocket | null = null
  let ready = false
  let closed = false
  let attempt = 0
  let seq = 0
  /** How many times in a row the server has said it does not know this player. */
  let unknown = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>()

  const failAll = (why: string) => {
    for (const [, request] of waiting) {
      clearTimeout(request.timer)
      request.reject(new Error(why))
    }
    waiting.clear()
  }

  const connect = async () => {
    if (closed) return
    let token: string | undefined
    try {
      token = (await supabase.auth.getSession()).data.session?.access_token
    } catch {
      token = undefined
    }
    if (closed) return
    if (!token) return again()

    let ws: WebSocket
    try {
      ws = new WebSocket(SERVER_URL)
    } catch {
      return again()
    }
    socket = ws
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', game, match: matchId, token }))
    ws.onmessage = (event) => {
      let message: { t?: unknown; id?: unknown } & Record<string, unknown>
      try {
        message = JSON.parse(String(event.data)) as typeof message
      } catch {
        return
      }
      if (message.t === 'ready') {
        ready = true
        attempt = 0
        unknown = 0
        return handlers.onReady(typeof message.ply === 'number' ? message.ply : 0)
      }
      if (message.t === 'ack' && typeof message.id === 'number') {
        const request = waiting.get(message.id)
        if (!request) return
        waiting.delete(message.id)
        clearTimeout(request.timer)
        request.resolve(message)
        return renewWhenFree()
      }
      // Refused at the door. Not in this game: there is no point knocking again for this match,
      // and the Edge Functions carry the game. Not known: the sign-in had just run out as the
      // door was knocked on, so it is tried again (a few times) with the new one.
      if (message.t === 'error') {
        if (message.code !== 'NOT_AUTHENTICATED' || ++unknown > 3) closed = true
        return ws.close()
      }
      if (typeof message.t === 'string') handlers.onMessage(message as { t: string } & Record<string, unknown>)
    }
    ws.onclose = () => {
      if (socket === ws) socket = null
      ready = false
      failAll('disconnected')
      again()
    }
    ws.onerror = () => ws.close()
  }

  function again() {
    if (closed) return
    clearTimeout(retry)
    retry = setTimeout(() => void connect(), RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)])
  }

  /** Lets go of the connection at once (without waiting for it to say it has closed) and opens another. */
  function renew(why: string, wait = 0) {
    const old = socket
    if (!old || closed) return
    socket = null
    ready = false
    old.onclose = null
    old.onmessage = null
    old.onerror = null
    try {
      old.close()
    } catch {
      // Already gone.
    }
    failAll(why)
    attempt = 0
    clearTimeout(retry)
    retry = setTimeout(() => void connect(), wait)
  }

  // The server knows the player by the sign-in they arrived with, and a sign-in lasts an hour.
  // When the app is given a new one the connection is opened again with it, between moves, so
  // the server never finds itself holding one that has run out in the middle of a game.
  let stale = false
  const renewWhenFree = () => {
    if (!stale || waiting.size > 0) return
    stale = false
    renew('new sign-in')
  }
  const auth = supabase.auth.onAuthStateChange((event) => {
    if (event !== 'TOKEN_REFRESHED' || closed) return
    stale = true
    renewWhenFree()
  })

  // Back from the background or from no signal: do not wait out the retry timer.
  const wake = () => {
    if (closed || socket || document.visibilityState !== 'visible') return
    attempt = 0
    clearTimeout(retry)
    void connect()
  }
  document.addEventListener('visibilitychange', wake)
  window.addEventListener('online', wake)

  void connect()

  return {
    get ready() {
      return ready && socket?.readyState === WebSocket.OPEN
    },
    request<T>(message: Record<string, unknown>) {
      return new Promise<T>((resolve, reject) => {
        if (!ready || !socket || socket.readyState !== WebSocket.OPEN) return reject(new Error('not connected'))
        const id = ++seq
        const timer = setTimeout(() => {
          waiting.delete(id)
          reject(new Error('no answer'))
          // A connection that does not answer is a dead one that has not been told (a phone
          // that changed network, say): it is dropped and another opened, instead of being
          // trusted with the next move as well.
          renew('no answer')
        }, REPLY_WITHIN_MS)
        waiting.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
        socket.send(JSON.stringify({ ...message, id }))
      })
    },
    send(message: Record<string, unknown>) {
      if (!ready || !socket || socket.readyState !== WebSocket.OPEN) return false
      socket.send(JSON.stringify(message))
      return true
    },
    close() {
      closed = true
      auth.data.subscription.unsubscribe()
      clearTimeout(retry)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
      failAll('closed')
      socket?.close()
      socket = null
    },
  }
}

/**
 * Sends a move by the quick road when it is open, and by the Edge Function when it is not, or
 * when the quick road lets the move down: no answer, a connection that dropped with the move in
 * the air, or a server that no longer knows the player's sign-in. The player is not told about
 * any of that; they are told only if the Edge Function cannot be reached either (this rejects).
 *
 * `retried` says the move was sent twice. Every move names the turn it is for, so a second
 * copy of one that did arrive is refused as out of turn, never played twice: see `alreadyPlayed`.
 */
export async function sendMove<T>(link: GameLink | null, message: Record<string, unknown>, byFunction: () => Promise<FunctionReply<T>>): Promise<{ reply: FunctionReply<T>; retried: boolean }> {
  if (!link?.ready) return { reply: await byFunction(), retried: false }
  try {
    const reply = await link.request<FunctionReply<T>>(message)
    if (reply.ok || reply.code !== 'NOT_AUTHENTICATED') return { reply, retried: false }
  } catch {
    // Dropped or unanswered: the Edge Function is asked, and the database decides.
  }
  return { reply: await byFunction(), retried: true }
}

/** A move sent a second time and refused only because the first copy had already been played. */
export const alreadyPlayed = (sent: { reply: { ok: boolean; code?: string }; retried: boolean }) =>
  sent.retried && !sent.reply.ok && (sent.reply.code === 'OUT_OF_SYNC' || sent.reply.code === 'NOT_YOUR_TURN')
