import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) } } }))

import { alreadyPlayed, type GameLink, sendMove } from './gameServer'

// A move goes by the quick road when it is open. When that road lets the move down, the player
// is not told: the move is sent again by the Edge Function, and the database decides.

const link = (answer: () => Promise<unknown>, ready = true): GameLink => ({ ready, request: answer as GameLink['request'], send: () => false, close: () => undefined })
const byFunction = (reply: { ok: boolean; code?: string }) => vi.fn(async () => reply as never)

describe('sending a move', () => {
  it('uses the open connection, and nothing else, when it answers', async () => {
    const fallback = byFunction({ ok: true })
    const sent = await sendMove(link(async () => ({ ok: true, ply: 4 })), { t: 'move' }, fallback)
    expect(sent).toEqual({ reply: { ok: true, ply: 4 }, retried: false })
    expect(fallback).not.toHaveBeenCalled()
  })

  it('passes on a refusal that is about the move itself', async () => {
    const fallback = byFunction({ ok: true })
    const sent = await sendMove(link(async () => ({ ok: false, code: 'ILLEGAL_MOVE' })), { t: 'move' }, fallback)
    expect(sent).toEqual({ reply: { ok: false, code: 'ILLEGAL_MOVE' }, retried: false })
    expect(fallback).not.toHaveBeenCalled()
  })

  it('goes by the Edge Function when there is no connection, or it is not ready', async () => {
    expect(await sendMove(null, { t: 'move' }, byFunction({ ok: true }))).toEqual({ reply: { ok: true }, retried: false })
    const never = vi.fn(async () => ({ ok: true }))
    expect(await sendMove(link(never, false), { t: 'move' }, byFunction({ ok: true }))).toEqual({ reply: { ok: true }, retried: false })
    expect(never).not.toHaveBeenCalled()
  })

  it('sends it again, quietly, when the connection drops or does not answer', async () => {
    const fallback = byFunction({ ok: true })
    const sent = await sendMove(
      link(async () => {
        throw new Error('no answer')
      }),
      { t: 'move' },
      fallback,
    )
    expect(sent).toEqual({ reply: { ok: true }, retried: true })
    expect(fallback).toHaveBeenCalledOnce()
  })

  it('sends it again when the server no longer knows the sign-in (it lasts an hour; a game can last longer)', async () => {
    const fallback = byFunction({ ok: true })
    const sent = await sendMove(link(async () => ({ ok: false, code: 'NOT_AUTHENTICATED' })), { t: 'move' }, fallback)
    expect(sent).toEqual({ reply: { ok: true }, retried: true })
  })

  it('tells the player only when the Edge Function cannot be reached either', async () => {
    const offline = vi.fn(async () => {
      throw new Error('Failed to fetch')
    })
    await expect(
      sendMove(
        link(async () => {
          throw new Error('disconnected')
        }),
        { t: 'move' },
        offline,
      ),
    ).rejects.toThrow('Failed to fetch')
  })
})

describe('a move that was sent twice', () => {
  it('is known to have been played when the second copy is refused as out of turn', () => {
    expect(alreadyPlayed({ reply: { ok: false, code: 'OUT_OF_SYNC' }, retried: true })).toBe(true)
    expect(alreadyPlayed({ reply: { ok: false, code: 'NOT_YOUR_TURN' }, retried: true })).toBe(true)
  })

  it('is not assumed played for any other refusal, or when it was sent only once', () => {
    expect(alreadyPlayed({ reply: { ok: false, code: 'ILLEGAL_MOVE' }, retried: true })).toBe(false)
    expect(alreadyPlayed({ reply: { ok: false, code: 'OUT_OF_SYNC' }, retried: false })).toBe(false)
    expect(alreadyPlayed({ reply: { ok: true }, retried: true })).toBe(false)
  })
})
