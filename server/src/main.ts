// The African Game Hub game server: open connections to players in a live game, so a move
// reaches the opponent in one short hop. See live.ts for what it does and does not decide.
//
// Runs as one program, one copy. Configuration comes from the environment:
//   PORT                        where to listen (default 8080)
//   SUPABASE_URL                the project's address
//   SUPABASE_SERVICE_ROLE_KEY   server-side key; never sent to anyone
//   APP_ORIGINS                 the app's address(es), comma-separated; browsers elsewhere are refused
//   ORIGIN_SECRET               when set, every request must carry it in X-Origin-Secret
//                               (the proxy in front adds it; /health from this machine is exempt)
import { createServer, type IncomingMessage } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { type WebSocket, WebSocketServer } from 'ws'
import { type ChessContext, ChessGames, chessRequest } from './chess.ts'
import { type DraughtsContext, DraughtsGames, draughtsRequest } from './draughts.ts'
import type { Applied, Member } from './live.ts'

// Local runs only: `npm run on-dev -- server:dev` names the development project's file.
if (process.env.AGH_ENV_FILE) process.loadEnvFile(process.env.AGH_ENV_FILE)

const need = (name: string, ...fallbacks: string[]): string => {
  for (const key of [name, ...fallbacks]) if (process.env[key]) return process.env[key]!
  throw new Error(`${name} is not set`)
}
const PORT = Number(process.env.PORT ?? 8080)
const ORIGIN_SECRET = process.env.ORIGIN_SECRET ?? ''
const allowedOrigins = (process.env.APP_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean)

const log = (level: 'info' | 'warn' | 'error', event: string, more: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), level, event, ...more }))

const admin = createClient(need('SUPABASE_URL', 'VITE_SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
})

const chess = new ChessGames({
  context: async (matchId, userId) => {
    const { data, error } = await admin.rpc('chess_move_context', { p_match_id: matchId, p_user_id: userId })
    if (error) throw error
    return data as ChessContext | null
  },
  applyMove: async (move) => {
    const { data, error } = await admin.rpc('chess_apply_move', {
      p_match_id: move.matchId,
      p_user_id: move.userId,
      p_expected_ply: move.expectedPly,
      p_san: move.san,
      p_uci: move.uci,
      p_fen_after: move.fenAfter,
      p_end_reason: move.endReason,
      p_winner: move.winner,
    })
    if (error) throw error
    return data as Applied
  },
})

const draughts = new DraughtsGames({
  context: async (matchId, userId) => {
    const { data, error } = await admin.rpc('draughts_move_context', { p_match_id: matchId, p_user_id: userId })
    if (error) throw error
    return data as DraughtsContext | null
  },
  applyMove: async (move) => {
    const { data, error } = await admin.rpc('draughts_apply_move', {
      p_match_id: move.matchId,
      p_user_id: move.userId,
      p_expected_ply: move.expectedPly,
      p_notation: move.notation,
      p_path: move.path,
      p_captures: move.captures,
      p_board_after: move.boardAfter,
      p_end_reason: move.endReason,
      p_winner: move.winner,
    })
    if (error) throw error
    return data as Applied
  },
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
}
const liveGames = () => Object.values(tables).reduce((sum, table) => sum + table.live(), 0)

// ---- Who may talk to us ----

const isLocal = (request: IncomingMessage) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')
const hasSecret = (request: IncomingMessage) => !ORIGIN_SECRET || request.headers['x-origin-secret'] === ORIGIN_SECRET
/** The player's own address: every connection arrives through the proxy, which passes it on. */
const addressOf = (request: IncomingMessage) => String(request.headers['x-forwarded-for'] ?? '').split(',')[0]!.trim() || request.socket.remoteAddress || '?'

let shuttingDown = false
const sockets = new Set<WebSocket>()

const http = createServer((request, response) => {
  const path = (request.url ?? '').split('?')[0]
  if (request.method === 'GET' && path === '/health') {
    if (!isLocal(request) && !hasSecret(request)) return void response.writeHead(403).end()
    response.writeHead(shuttingDown ? 503 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    return void response.end(JSON.stringify({ ok: !shuttingDown, games: liveGames(), connections: sockets.size, uptime: Math.round(process.uptime()) }))
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
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request))
})

// ---- One connection ----

const HELLO_WITHIN_MS = 10_000
const WINDOW_MS = 10_000
const MAX_MESSAGES = 40
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
  sockets.add(ws)
  const address = addressOf(request)
  let alive = true
  let joined: { member: Member; matchId: string; table: Table } | null = null
  let joining = false
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
      log('error', 'message_failed', { message: String(error) })
      if (typeof message.id === 'number') send({ t: 'ack', id: message.id, ok: false, code: 'SERVER_ERROR' })
    })
  })

  async function handle(message: Record<string, unknown>) {
    if (message.t === 'hello') {
      if (joined || joining) return
      const { token, match, game } = message
      if (typeof token !== 'string' || typeof match !== 'string' || !UUID.test(match)) return send({ t: 'error', code: 'BAD_REQUEST' })
      const table = typeof game === 'string' && Object.hasOwn(tables, game) ? tables[game]! : null
      if (!table) return send({ t: 'error', code: 'GAME_NOT_AVAILABLE' })
      joining = true
      try {
        // Who is asking comes from their session token, checked with the auth server once, when
        // they connect. Never from anything else in the message.
        const { data, error } = await admin.auth.getUser(token)
        if (error || !data.user) return send({ t: 'error', code: 'NOT_AUTHENTICATED' })
        const member: Member = { userId: data.user.id, send }
        const result = await table.join(member, match)
        if (!result.ok) return send({ t: 'error', code: result.code })
        if (ws.readyState !== ws.OPEN) return table.leave(member, match)
        joined = { member, matchId: match, table }
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
      const asked = typeof ply === 'number' && Number.isInteger(ply) && ply >= 0 && ply <= 2000 ? joined.table.move(joined.member, joined.matchId, ply, message) : null
      if (!asked) return send({ t: 'ack', id, ok: false, code: 'BAD_REQUEST' })
      return send({ t: 'ack', id, ...(await asked) })
    }
  }

  ws.on('close', () => {
    clearTimeout(hello)
    clearInterval(beat)
    sockets.delete(ws)
    if (joined) joined.table.leave(joined.member, joined.matchId)
  })
  ws.on('error', (error) => log('warn', 'socket_error', { address, message: String(error) }))
})

// ---- Starting and stopping ----

http.listen(PORT, () => log('info', 'listening', { port: PORT, origins: allowedOrigins, secret: Boolean(ORIGIN_SECRET) }))

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
process.on('unhandledRejection', (error) => log('error', 'unhandled_rejection', { message: String(error) }))
