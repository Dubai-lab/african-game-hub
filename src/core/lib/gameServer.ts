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
        return handlers.onReady(typeof message.ply === 'number' ? message.ply : 0)
      }
      if (message.t === 'ack' && typeof message.id === 'number') {
        const request = waiting.get(message.id)
        if (!request) return
        waiting.delete(message.id)
        clearTimeout(request.timer)
        return request.resolve(message)
      }
      // Refused at the door (not in this game, signed out): there is no point knocking again
      // for this match. The Edge Functions carry the game.
      if (message.t === 'error') {
        closed = true
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
        }, REPLY_WITHIN_MS)
        waiting.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
        socket.send(JSON.stringify({ ...message, id }))
      })
    },
    close() {
      closed = true
      clearTimeout(retry)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
      failAll('closed')
      socket?.close()
      socket = null
    },
  }
}
