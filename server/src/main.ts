// The African Game Hub game server: open connections to players in a live game, so a move
// reaches the opponent in one short hop. See live.ts for what it does and does not decide.
//
// Runs as one program, one copy. Configuration comes from the environment:
//   PORT                 where to listen (default 8080)
//   SUPABASE_URL         the project's address
//   SUPABASE_ANON_KEY    the public key (the one the app itself uses); for asking who a player is
//   GAME_SERVER_KEY      this server's own key: a token for the `game_server` database role, which
//                        can read a game as a player sees it and record a move, and nothing else
//                        (no table, no wallet). Made by `npm run server-keys`.
//   APP_ORIGINS          the app's address(es), comma-separated; browsers elsewhere are refused
//   ORIGIN_SECRET        when set, every request must carry it in X-Origin-Secret
//                        (the proxy in front adds it; /health from this machine is exempt)
//
// SUPABASE_SERVICE_ROLE_KEY is still accepted in place of the two keys, so a server set up the
// old way keeps running, but it is a key that can do anything and should not be on this
// machine: the server says so in its log every time it starts with it.
import { createServer, type IncomingMessage } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { type WebSocket, WebSocketServer } from 'ws'
import { type ChessContext, ChessGames, chessRequest } from './chess.ts'
import { type DraughtsContext, DraughtsGames, draughtsRequest } from './draughts.ts'
import { type Applied, describe, type Member } from './live.ts'
import { ludoRequest, LudoTables } from './ludo.ts'
import { type PoolContext, PoolGames, poolRequest } from './pool.ts'

// Local runs only: `npm run on-dev -- server:dev` names the development project's file.
if (process.env.AGH_ENV_FILE) process.loadEnvFile(process.env.AGH_ENV_FILE)

const env = (...names: string[]): string | undefined => names.map((name) => process.env[name]).find(Boolean)
const PORT = Number(process.env.PORT ?? 8080)
const ORIGIN_SECRET = process.env.ORIGIN_SECRET ?? ''
const allowedOrigins = (process.env.APP_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean)

const log = (level: 'info' | 'warn' | 'error', event: string, more: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), level, event, ...more }))

// ---- The database, with as little power as the job needs ----

const url = env('SUPABASE_URL', 'VITE_SUPABASE_URL')
const anonKey = env('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY')
const ownKey = env('GAME_SERVER_KEY')
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
if (!url) throw new Error('SUPABASE_URL is not set')
const narrow = Boolean(ownKey && anonKey)
if (!narrow && !serviceKey) throw new Error('GAME_SERVER_KEY and SUPABASE_ANON_KEY are not set')

const quiet = { auth: { persistSession: false, autoRefreshToken: false } }
/** Asks the auth server who a session token belongs to. Needs no more than the public key. */
const auth = createClient(url, narrow ? anonKey! : serviceKey!, quiet).auth
/** Calls the game functions. With the server's own key it can call those and nothing else. */
const db = narrow ? createClient(url, anonKey!, { accessToken: async () => ownKey! }) : createClient(url, serviceKey!, quiet)

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args)
  if (error) throw error
  return data as T
}

const chess = new ChessGames({
  context: (matchId, userId) => call<ChessContext | null>('chess_move_context', { p_match_id: matchId, p_user_id: userId }),
  applyMove: (move) =>
    call<Applied>('chess_apply_move', {
      p_match_id: move.matchId,
      p_user_id: move.userId,
      p_expected_ply: move.expectedPly,
      p_san: move.san,
      p_uci: move.uci,
      p_fen_after: move.fenAfter,
      p_end_reason: move.endReason,
      p_winner: move.winner,
    }),
})

const draughts = new DraughtsGames({
  context: (matchId, userId) => call<DraughtsContext | null>('draughts_move_context', { p_match_id: matchId, p_user_id: userId }),
  applyMove: (move) =>
    call<Applied>('draughts_apply_move', {
      p_match_id: move.matchId,
      p_user_id: move.userId,
      p_expected_ply: move.expectedPly,
      p_notation: move.notation,
      p_path: move.path,
      p_captures: move.captures,
      p_board_after: move.boardAfter,
      p_end_reason: move.endReason,
      p_winner: move.winner,
    }),
})

const pool = new PoolGames({
  context: (matchId, userId) => call<PoolContext | null>('pool_shot_context', { p_match_id: matchId, p_user_id: userId }),
  applyShot: (shot) =>
    call<Applied>('pool_apply_shot', { p_match_id: shot.matchId, p_user_id: shot.userId, p_shot_no: shot.shotNo, p_state: shot.state, p_shot: shot.shot, p_result: shot.result }),
})

const ludo = new LudoTables({
  table: (matchId, userId) => call<Record<string, unknown> | null>('ludo_table_context', { p_match_id: matchId, p_user_id: userId }),
  action: (matchId, userId, request) =>
    call<{ ok: boolean; code?: string }>('ludo_action', {
      p_match_id: matchId,
      p_user_id: userId,
      p_action: request.action,
      p_piece: request.piece,
      p_turn_no: request.turnNo,
      p_die: request.die,
      p_color: request.color,
      p_full: request.full,
    }),
})

/** Every game played here: how to join and leave it, and how to read and play a move. */
type Table = {
  join: (member: Member, matchId: string) => Promise<{ ok: true; ply: number } | { ok: false; code: string }>
  leave: (member: Member, matchId: string) => void
  /** Null when the message does not describe a move of this game. */
  move: (member: Member, matchId: string, ply: number, message: Record<string, unknown>) => Promise<Record<string, unknown>> | null
  live: () => number
  idle: () => Promise<void>
}
const tables: Record<string, Table> = {
  chess: {
    join: (member, matchId) => chess.join(member, matchId),
    leave: (member, matchId) => chess.leave(member, matchId),
    move: (member, matchId, ply, message) => {
      const request = chessRequest(message)
      return request && chess.move(member, matchId, ply, request)
    },
    live: () => chess.live,
    idle: () => chess.idle(),
  },
  draughts: {
    join: (member, matchId) => draughts.join(member, matchId),
    leave: (member, matchId) => draughts.leave(member, matchId),
    move: (member, matchId, ply, message) => {
      const request = draughtsRequest(message)
      return request && draughts.move(member, matchId, ply, request)
    },
    live: () => draughts.live,
    idle: () => draughts.idle(),
  },
  pool: {
    join: (member, matchId) => pool.join(member, matchId),
    leave: (member, matchId) => pool.leave(member, matchId),
    move: (member, matchId, ply, message) => {
      const request = poolRequest(message)
      return request && pool.move(member, matchId, ply, request)
    },
    live: () => pool.live,
    idle: () => pool.idle(),
  },
  ludo: {
    join: (member, matchId) => ludo.join(member, matchId),
    leave: (member, matchId) => ludo.leave(member, matchId),
    // The database decides whether the request is on the right turn (it carries its own turn number).
    move: (member, matchId, _ply, message) => {
      const request = ludoRequest(message)
      return request && ludo.act(member, matchId, request)
    },
    live: () => ludo.live,
    idle: () => Promise.resolve(),
  },
}
const liveGames = () => Object.values(tables).reduce((sum, table) => sum + table.live(), 0)

/**
 * Who a session token belongs to, if they may play: the auth server must know the token, and
 * the account must not be banned. Null otherwise.
 */
async function admitted(token: string): Promise<string | null> {
  const { data, error } = await auth.getUser(token)
  if (error || !data.user) return null
  return (await call<boolean>('game_server_admits', { p_user_id: data.user.id })) ? data.user.id : null
}

// ---- Who may talk to us ----

const isLocal = (request: IncomingMessage) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')
const hasSecret = (request: IncomingMessage) => !ORIGIN_SECRET || request.headers['x-origin-secret'] === ORIGIN_SECRET
/**
 * The player's own address. Every connection arrives through the proxy, which adds the address
 * it saw to the END of X-Forwarded-For. Anything before that was written by the caller and
 * proves nothing, so only the last entry is believed.
 */
const addressOf = (request: IncomingMessage) => String(request.headers['x-forwarded-for'] ?? '').split(',').at(-1)!.trim() || request.socket.remoteAddress || '?'

// Limits, so that one address (or one script) cannot use the server up. Phone networks put
// many real players behind one address, so the per-address numbers are generous: far above a
// neighbourhood of players, far below a flood.
const MAX_CONNECTIONS = 4000
const MAX_PER_ADDRESS = 120
const MAX_WAITING_PER_ADDRESS = 15
const NEW_PER_ADDRESS = 60
const NEW_WINDOW_MS = 10_000

let shuttingDown = false
const sockets = new Set<WebSocket>()
const perAddress = new Map<string, { open: number; waiting: number; recent: number[] }>()
const counts = (address: string) => {
  let entry = perAddress.get(address)
  if (!entry) perAddress.set(address, (entry = { open: 0, waiting: 0, recent: [] }))
  return entry
}
let refused = 0

const http = createServer((request, response) => {
  const path = (request.url ?? '').split('?')[0]
  if (request.method === 'GET' && path === '/health') {
    if (!isLocal(request) && !hasSecret(request)) return void response.writeHead(403).end()
    response.writeHead(shuttingDown ? 503 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    return void response.end(JSON.stringify({ ok: !shuttingDown, games: liveGames(), connections: sockets.size, refused, uptime: Math.round(process.uptime()) }))
  }
  response.writeHead(404).end()
})

// A message from a player is tiny. Anything large is not from our app.
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 })

http.on('upgrade', (request, socket, head) => {
  const path = (request.url ?? '').split('?')[0]
  const origin = request.headers.origin
  const refuse = (status: string) => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
    socket.destroy()
  }
  if (path !== '/ws') return refuse('404 Not Found')
  if (shuttingDown) return refuse('503 Service Unavailable')
  if (!hasSecret(request)) return refuse('403 Forbidden')
  // A browser on another site is refused. (Something that is not a browser sends no Origin; it
  // still needs a real player's session token to do anything.)
  if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) return refuse('403 Forbidden')

  const address = addressOf(request)
  const entry = counts(address)
  const now = Date.now()
  while (entry.recent.length > 0 && now - entry.recent[0]! > NEW_WINDOW_MS) entry.recent.shift()
  entry.recent.push(now)
  if (sockets.size >= MAX_CONNECTIONS || entry.open >= MAX_PER_ADDRESS || entry.waiting >= MAX_WAITING_PER_ADDRESS || entry.recent.length > NEW_PER_ADDRESS) {
    // Said once in a while, not once per attempt: a flood must not fill the log as well.
    if (refused++ % 200 === 0) log('warn', 'connection_refused', { address, open: entry.open, waiting: entry.waiting, total: sockets.size })
    return refuse('429 Too Many Requests')
  }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request))
})

// ---- One connection ----

const HELLO_WITHIN_MS = 10_000
const WINDOW_MS = 10_000
const MAX_MESSAGES = 40
// How long a player is taken at their word before the server asks again who they are. A ban, a
// signed-out session or a deleted account is noticed within this long, in the middle of a game.
const RECHECK_MS = 5 * 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
  sockets.add(ws)
  const address = addressOf(request)
  const entry = counts(address)
  entry.open++
  entry.waiting++
  let alive = true
  let joined: { member: Member; matchId: string; table: Table; token: string; checkedAt: number } | null = null
  let joining = false
  let waiting = true
  const admit = () => {
    if (waiting) entry.waiting--
    waiting = false
  }
  const recent: number[] = []
  const send = (message: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
  }
  const hello = setTimeout(() => !joined && ws.close(4001, 'no hello'), HELLO_WITHIN_MS)

  ws.on('pong', () => (alive = true))
  const beat = setInterval(() => {
    // No answer to the last ping: the phone has gone. Free the connection.
    if (!alive) return ws.terminate()
    alive = false
    ws.ping()
  }, 25_000)

  ws.on('message', (raw) => {
    const now = Date.now()
    while (recent.length > 0 && now - recent[0]! > WINDOW_MS) recent.shift()
    recent.push(now)
    // Far more than anyone playing sends: a script, not a player.
    if (recent.length > MAX_MESSAGES) return ws.close(4008, 'too fast')

    let message: Record<string, unknown>
    try {
      message = JSON.parse(String(raw)) as Record<string, unknown>
    } catch {
      return ws.close(4000, 'bad message')
    }
    void handle(message).catch((error) => {
      log('error', 'message_failed', { message: describe(error) })
      if (typeof message.id === 'number') send({ t: 'ack', id: message.id, ok: false, code: 'SERVER_ERROR' })
    })
  })

  async function handle(message: Record<string, unknown>) {
    if (message.t === 'hello') {
      if (joined || joining) return
      const { token, match, game } = message
      if (typeof token !== 'string' || token.length > 4000 || typeof match !== 'string' || !UUID.test(match)) return send({ t: 'error', code: 'BAD_REQUEST' })
      const table = typeof game === 'string' && Object.hasOwn(tables, game) ? tables[game]! : null
      if (!table) return send({ t: 'error', code: 'GAME_NOT_AVAILABLE' })
      joining = true
      try {
        // Who is asking comes from their session token, checked with the auth server. Never
        // from anything else in the message.
        const userId = await admitted(token)
        if (!userId) return send({ t: 'error', code: 'NOT_AUTHENTICATED' })
        const member: Member = { userId, send }
        const result = await table.join(member, match)
        if (!result.ok) return send({ t: 'error', code: result.code })
        if (ws.readyState !== ws.OPEN) return table.leave(member, match)
        joined = { member, matchId: match, table, token, checkedAt: Date.now() }
        admit()
        send({ t: 'ready', ply: result.ply })
      } finally {
        joining = false
      }
      return
    }

    if (message.t === 'move') {
      const { id, ply } = message
      if (typeof id !== 'number') return
      if (!joined) return send({ t: 'ack', id, ok: false, code: 'NOT_AUTHENTICATED' })

      // Every so often the player is asked for again. A token that has run out, a session that
      // was signed out, a ban: the connection is closed. The app reconnects with a fresh token
      // if it has one, and this one move goes through the Edge Function, which checks too.
      if (Date.now() - joined.checkedAt > RECHECK_MS) {
        const still = await admitted(joined.token).catch(() => null)
        if (still !== joined.member.userId) {
          send({ t: 'ack', id, ok: false, code: 'NOT_AUTHENTICATED' })
          return ws.close(4401, 'sign in again')
        }
        joined.checkedAt = Date.now()
      }

      const asked = typeof ply === 'number' && Number.isInteger(ply) && ply >= 0 && ply <= 1_000_000 ? joined.table.move(joined.member, joined.matchId, ply, message) : null
      if (!asked) return send({ t: 'ack', id, ok: false, code: 'BAD_REQUEST' })
      return send({ t: 'ack', id, ...(await asked) })
    }
  }

  ws.on('close', () => {
    clearTimeout(hello)
    clearInterval(beat)
    sockets.delete(ws)
    admit()
    entry.open--
    if (joined) joined.table.leave(joined.member, joined.matchId)
  })
  ws.on('error', (error) => log('warn', 'socket_error', { address, message: String(error) }))
})

// Addresses that have gone quiet are forgotten.
setInterval(() => {
  const now = Date.now()
  for (const [address, entry] of perAddress) {
    while (entry.recent.length > 0 && now - entry.recent[0]! > NEW_WINDOW_MS) entry.recent.shift()
    if (entry.open <= 0 && entry.recent.length === 0) perAddress.delete(address)
  }
}, 30_000).unref()

// ---- Starting and stopping ----

http.listen(PORT, () => {
  log('info', 'listening', { port: PORT, origins: allowedOrigins, secret: Boolean(ORIGIN_SECRET), key: narrow ? 'game_server' : 'service_role' })
  if (!narrow) log('warn', 'full_access_key', { message: 'Running with the service role key. Set GAME_SERVER_KEY and SUPABASE_ANON_KEY, then remove SUPABASE_SERVICE_ROLE_KEY from this machine.' })
})

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  log('info', 'stopping', { signal, games: liveGames(), connections: sockets.size })
  // Whatever happens, be gone inside ten seconds.
  setTimeout(() => process.exit(0), 9000).unref()
  http.close()
  // Moves already accepted are answered first; nothing is held only in memory.
  await Promise.race([Promise.all(Object.values(tables).map((table) => table.idle())), new Promise((resolve) => setTimeout(resolve, 5000))])
  // The app reconnects by itself, and plays through the Edge Functions until we are back.
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: 'restarting' }))
    ws.close(1012, 'restarting')
  }
  setTimeout(() => process.exit(0), 500)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('unhandledRejection', (error) => log('error', 'unhandled_rejection', { message: describe(error) }))
