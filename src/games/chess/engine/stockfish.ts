// Talks to Stockfish, which runs as its own program in a Web Worker (public/engine/).
//
// Stockfish is GPL-3.0 software. It is shipped unmodified as separate files and spoken to only
// through UCI, the standard text protocol for chess engines; none of its code is part of our
// bundle. Its licence and source link are in public/engine/COPYING.txt and ASSETS.md.

const ENGINE_URL = '/engine/stockfish.wasm.js'
const READY_TIMEOUT_MS = 30_000

export type SearchLimits = {
  /** Stockfish "Skill Level", 0 (weakest) to 20 (full strength). */
  skill: number
  depth: number
  /** Upper bound on thinking time, so a slow phone never stalls the game. */
  moveTimeMs: number
}

export type Evaluation = {
  bestMove: string | null
  /** Centipawns for the side to move; null when the score is a forced mate. */
  cp: number | null
  /** Moves until mate: positive when the side to move is mating, negative when it is being mated. */
  mate: number | null
}

export class ChessEngine {
  private worker: Worker | null = null
  private ready: Promise<void> | null = null
  private listeners = new Set<(line: string) => void>()
  private searching: { cancel: () => void } | null = null

  /** Downloads (first time only) and starts the engine. Safe to call more than once. */
  start(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise<void>((resolve, reject) => {
      let worker: Worker
      try {
        worker = new Worker(ENGINE_URL)
      } catch (error) {
        return reject(error instanceof Error ? error : new Error('Could not start the chess engine'))
      }
      this.worker = worker
      const timeout = setTimeout(() => reject(new Error('The chess engine took too long to start')), READY_TIMEOUT_MS)
      worker.onerror = () => {
        clearTimeout(timeout)
        reject(new Error('The chess engine could not be loaded'))
      }
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const line = typeof event.data === 'string' ? event.data : ''
        if (line === 'readyok') {
          clearTimeout(timeout)
          resolve()
        }
        for (const listener of this.listeners) listener(line)
      }
      worker.postMessage('uci')
      worker.postMessage('isready')
    })
    // A failed start can be retried (for example once the connection is back).
    this.ready.catch(() => this.dispose())
    return this.ready
  }

  /** The engine's move for a position, in UCI form ("e2e4", "e7e8q"). Rejects if cancelled. */
  async bestMove(fen: string, limits: SearchLimits): Promise<string> {
    const { bestMove } = await this.search(fen, limits)
    if (!bestMove) throw new Error('The engine found no move')
    return bestMove
  }

  /**
   * The engine's judgement of a position at full strength: its best move, and the score from
   * the point of view of the side to move (centipawns, or moves until mate). For game review.
   */
  analyse(fen: string, limits: { depth: number; moveTimeMs: number }): Promise<Evaluation> {
    return this.search(fen, { skill: 20, ...limits })
  }

  private async search(fen: string, limits: SearchLimits): Promise<Evaluation> {
    await this.start()
    const worker = this.worker
    if (!worker) throw new Error('The chess engine is not running')
    this.searching?.cancel()

    return new Promise<Evaluation>((resolve, reject) => {
      let cp: number | null = null
      let mate: number | null = null
      const done = () => {
        this.listeners.delete(onLine)
        if (this.searching === handle) this.searching = null
      }
      const onLine = (line: string) => {
        if (line.startsWith('info ')) {
          // The latest "score" line before the answer is the one the answer is based on.
          const score = / score (cp|mate) (-?\d+)/.exec(line)
          if (score) {
            cp = score[1] === 'cp' ? Number(score[2]) : null
            mate = score[1] === 'mate' ? Number(score[2]) : null
          }
          return
        }
        if (!line.startsWith('bestmove')) return
        done()
        const move = line.split(' ')[1]
        resolve({ bestMove: move && move !== '(none)' ? move : null, cp, mate })
      }
      const handle = {
        cancel: () => {
          done()
          worker.postMessage('stop')
          reject(new Error('cancelled'))
        },
      }
      this.searching = handle
      this.listeners.add(onLine)
      worker.postMessage(`setoption name Skill Level value ${limits.skill}`)
      worker.postMessage(`position fen ${fen}`)
      worker.postMessage(`go depth ${limits.depth} movetime ${limits.moveTimeMs}`)
    })
  }

  cancel() {
    this.searching?.cancel()
  }

  dispose() {
    this.searching?.cancel()
    this.worker?.terminate()
    this.worker = null
    this.ready = null
    this.listeners.clear()
  }
}
