import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './testDb'

// The admin functions, blocking and reporting. The admin_* functions are called the way the
// admin-api Edge Function calls them (service role); block/report are called as the players.

let db: TestDb
const users: Record<string, string> = {}
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function as(user: string, sql: string, params: unknown[] = []): Promise<Json> {
  return db.as('authenticated', users[user]!, async () => (await db.rows<{ r: Json }>(`select ${sql} as r`, params))[0]!.r)
}
/** A call from the admin-api Edge Function. */
async function service(sql: string, params: unknown[] = []): Promise<Json> {
  return db.as('service_role', null, async () => (await db.rows<{ r: Json }>(`select ${sql} as r`, params))[0]!.r)
}
const wallet = async (user: string) =>
  (await db.rows<{ bonus: number; cash: number }>(`select bonus_balance::int as bonus, cash_balance::int as cash from public.wallets where user_id = $1`, [users[user]]))[0]!

async function match(a: string, b: string, stake = 0) {
  await db.pg.query(`select public.join_match_queue($1, 'chess', $2, '{"time_control":"3+2"}', 'blitz')`, [users[a], stake])
  const [row] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'chess', $2, '{"time_control":"3+2"}', 'blitz') as r`, [users[b], stake])
  return row!.r.match_id as string
}

beforeAll(async () => {
  db = await createTestDb()
  for (const name of ['boss', 'amina', 'bayo', 'chika', 'dayo']) {
    users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'GH', age_confirmed: true })
  }
  await db.pg.query(`insert into public.admins (user_id) values ($1)`, [users.boss])
}, 120_000)

afterAll(async () => {
  expect(await db.integrityProblems()).toEqual([])
  await db.close()
})

describe('who may call the admin functions', () => {
  it('no player or visitor can call any of them, admin or not', async () => {
    const calls = [
      `public.admin_overview()`,
      `public.admin_search_players('', 10, 0)`,
      `public.admin_player('${users.amina}')`,
      `public.admin_set_ban('${users.boss}', '${users.amina}', true, 'because I can')`,
      `public.admin_adjust_balance('${users.boss}', '${users.amina}', 500, 'cash', 'free money please')`,
      `public.admin_matches(null, 10, 0)`,
      `public.admin_reports(null, 10, 0)`,
      `public.admin_revenue(7)`,
      `public.admin_integrity()`,
      `public.admin_audit(10, 0)`,
    ]
    for (const who of ['amina', 'boss']) {
      for (const call of calls) {
        await expect(as(who, call), `${who}: ${call}`).rejects.toThrow(/permission denied/)
      }
    }
    for (const call of calls) {
      await expect(db.as('anon', null, () => db.rows(`select ${call}`))).rejects.toThrow(/permission denied/)
    }
    expect(await wallet('amina')).toEqual({ bonus: 1000, cash: 0 })
  })

  it('players cannot read or write the audit log, reports, or other people’s blocks', async () => {
    await expect(db.as('authenticated', users.amina!, () => db.rows(`select * from private.admin_audit_log`))).rejects.toThrow(/permission denied/)
    expect(await db.as('authenticated', users.amina!, () => db.rows(`select * from public.reports`).catch(() => []))).toEqual([])
    await expect(
      db.as('authenticated', users.amina!, () => db.rows(`insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`, [users.amina, users.bayo])),
    ).rejects.toThrow()
  })
})

describe('adjusting a balance', () => {
  it('goes through the ledger and is written to the audit log', async () => {
    const reply = await service(`public.admin_adjust_balance($1, $2, 250, 'cash', 'Refund for a game lost to an outage')`, [users.boss, users.amina])
    expect(reply.ok).toBe(true)
    expect(await wallet('amina')).toEqual({ bonus: 1000, cash: 250 })
    const [entry] = await db.rows(`select entry_type, balance_type, amount::int as amount, balance_after::int as after from public.ledger_entries where id = $1`, [
      reply.ledger_entry_id,
    ])
    expect(entry).toEqual({ entry_type: 'adjustment', balance_type: 'cash', amount: 250, after: 250 })
    const [log] = await db.rows<{ action: string; details: Json }>(`select action, details from private.admin_audit_log where target_user_id = $1`, [users.amina])
    expect(log!.action).toBe('adjust_balance')
    expect(log!.details).toMatchObject({ amount: 250, balance_type: 'cash', reason: 'Refund for a game lost to an outage' })
  })

  it('needs a reason, cannot overdraw, and an admin cannot adjust their own wallet', async () => {
    expect(await service(`public.admin_adjust_balance($1, $2, 100, 'cash', ' ')`, [users.boss, users.bayo])).toEqual({ ok: false, code: 'REASON_REQUIRED' })
    expect(await service(`public.admin_adjust_balance($1, $2, -5000, 'bonus', 'Clawing back too much')`, [users.boss, users.bayo])).toEqual({
      ok: false,
      code: 'INSUFFICIENT_BALANCE',
    })
    expect(await service(`public.admin_adjust_balance($1, $2, 0, 'cash', 'Nothing at all')`, [users.boss, users.bayo])).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await service(`public.admin_adjust_balance($1, $2, 100, 'gold', 'No such balance')`, [users.boss, users.bayo])).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await service(`public.admin_adjust_balance($1, $1, 100000, 'cash', 'A little gift to myself')`, [users.boss])).toEqual({
      ok: false,
      code: 'CANNOT_ADJUST_SELF',
    })
    expect(await wallet('bayo')).toEqual({ bonus: 1000, cash: 0 })
    expect(await wallet('boss')).toEqual({ bonus: 1000, cash: 0 })
    // A refused adjustment leaves no trace in the log.
    expect(await db.rows(`select 1 from private.admin_audit_log where target_user_id in ($1, $2)`, [users.bayo, users.boss])).toEqual([])
  })

  it('the audit log cannot be edited or emptied, by anyone', async () => {
    await expect(db.pg.query(`update private.admin_audit_log set action = 'nothing'`)).rejects.toThrow(/append-only/)
    await expect(db.pg.query(`delete from private.admin_audit_log`)).rejects.toThrow(/append-only/)
    await expect(db.pg.query(`truncate private.admin_audit_log`)).rejects.toThrow(/append-only/)
  })
})

describe('banning', () => {
  it('a banned player cannot queue or chat; unbanning restores them', async () => {
    expect(await service(`public.admin_set_ban($1, $2, true, '')`, [users.boss, users.dayo])).toEqual({ ok: false, code: 'REASON_REQUIRED' })
    await db.pg.query(`select public.join_match_queue($1, 'chess', 0, '{"time_control":"3+2"}', 'blitz')`, [users.dayo])
    expect(await service(`public.admin_set_ban($1, $2, true, 'Abusive messages')`, [users.boss, users.dayo])).toEqual({ ok: true })
    // Taken out of the queue at once.
    expect(await db.rows(`select 1 from public.match_queue where user_id = $1`, [users.dayo])).toEqual([])
    const [join] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'chess', 0, '{"time_control":"3+2"}', 'blitz') as r`, [users.dayo])
    expect(join!.r).toEqual({ status: 'error', code: 'BANNED' })
    expect((await service(`public.admin_player($1)`, [users.dayo])).ban_reason).toBe('Abusive messages')

    expect(await service(`public.admin_set_ban($1, $2, false, 'Appeal accepted')`, [users.boss, users.dayo])).toEqual({ ok: true })
    const player = await service(`public.admin_player($1)`, [users.dayo])
    expect(player.is_banned).toBe(false)
    expect(player.ban_reason).toBeNull()
    expect(player.admin_actions.map((a: Json) => a.action)).toEqual(['unban', 'ban'])
    expect(player.admin_actions[0].admin).toBe('boss')
  })

  it('an admin cannot be banned from the admin app', async () => {
    expect(await service(`public.admin_set_ban($1, $1, true, 'Locking myself out')`, [users.boss])).toEqual({ ok: false, code: 'CANNOT_BAN_ADMIN' })
  })

  it('a banned player cannot message a friend or chat in a match', async () => {
    await as('chika', `public.send_friend_request('dayo')`)
    await as('dayo', `public.respond_friend_request($1, true)`, [users.chika])
    const matchId = await match('chika', 'dayo')
    await service(`public.admin_set_ban($1, $2, true, 'Abusive messages')`, [users.boss, users.dayo])
    expect(await as('dayo', `public.send_direct_message($1, 'hello')`, [users.chika])).toEqual({ ok: false, code: 'BANNED' })
    expect(await as('dayo', `public.send_match_message($1, 'text', 'hello')`, [matchId])).toEqual({ ok: false, code: 'CHAT_OFF_YOU' })
    await service(`public.admin_set_ban($1, $2, false, 'Test over, restore')`, [users.boss, users.dayo])
    await db.pg.query(`select private.finish_match($1, 'aborted', null, 'test_cleanup')`, [matchId])
  })
})

describe('blocking', () => {
  it('ends the friendship and closes every channel between the two', async () => {
    await as('amina', `public.send_friend_request('bayo')`)
    await as('bayo', `public.respond_friend_request($1, true)`, [users.amina])
    expect((await as('amina', `public.send_direct_message($1, 'hi')`, [users.bayo])).ok).toBe(true)

    expect(await as('bayo', `public.block_player($1)`, [users.amina])).toEqual({ ok: true })
    expect(await as('bayo', `public.block_player($1)`, [users.bayo])).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await as('amina', `public.send_direct_message($1, 'hi again')`, [users.bayo])).toEqual({ ok: false, code: 'NOT_FRIENDS' })
    // Neither can ask the other again, and the reply does not say who blocked whom.
    expect(await as('amina', `public.send_friend_request('bayo')`)).toEqual({ ok: false, code: 'CANNOT_CONTACT' })
    expect(await as('bayo', `public.send_friend_request('amina')`)).toEqual({ ok: false, code: 'CANNOT_CONTACT' })

    // If matchmaking pairs them anyway, the chat stays shut both ways.
    const matchId = await match('amina', 'bayo')
    expect(await as('amina', `public.send_match_message($1, 'emoji', '😂')`, [matchId])).toEqual({ ok: false, code: 'CHAT_OFF_OPPONENT' })
    expect(await as('bayo', `public.send_match_message($1, 'emoji', '😂')`, [matchId])).toEqual({ ok: false, code: 'CHAT_OFF_OPPONENT' })
    await db.pg.query(`select private.finish_match($1, 'aborted', null, 'test_cleanup')`, [matchId])

    // The blocker sees their block; the blocked player sees nothing.
    expect(await db.as('authenticated', users.bayo!, () => db.rows(`select blocked_id from public.blocks`))).toEqual([{ blocked_id: users.amina }])
    expect(await db.as('authenticated', users.amina!, () => db.rows(`select blocked_id from public.blocks`))).toEqual([])
    // Only the blocker can lift it.
    await as('amina', `public.unblock_player($1)`, [users.bayo])
    expect(await as('amina', `public.send_friend_request('bayo')`)).toEqual({ ok: false, code: 'CANNOT_CONTACT' })
    await as('bayo', `public.unblock_player($1)`, [users.amina])
    expect(await as('amina', `public.send_friend_request('bayo')`)).toEqual({ ok: true, status: 'pending' })
  })
})

describe('reports', () => {
  let matchId: string

  it('a report from a match carries what was said in that match, and nothing else', async () => {
    matchId = await match('amina', 'chika', 100)
    await as('chika', `public.send_match_message($1, 'text', 'you are terrible')`, [matchId])
    await as('amina', `public.send_match_message($1, 'emoji', '😢')`, [matchId])

    // Only someone who played in the match can cite it.
    expect(await as('bayo', `public.report_player($1, 'abuse', null, $2)`, [users.chika, matchId])).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await as('amina', `public.report_player($1, 'nonsense', null, $2)`, [users.chika, matchId])).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await as('amina', `public.report_player($1, 'abuse', null, null)`, [users.amina])).toEqual({ ok: false, code: 'BAD_REQUEST' })

    expect(await as('amina', `public.report_player($1, 'abuse', ' Insulting me ', $2)`, [users.chika, matchId])).toEqual({ ok: true })
    expect(await as('amina', `public.report_player($1, 'abuse', 'again', $2)`, [users.chika, matchId])).toEqual({ ok: false, code: 'ALREADY_REPORTED' })

    const list = await service(`public.admin_reports('open', 10, 0)`)
    expect(list.total).toBe(1)
    const report = list.rows[0]
    expect(report).toMatchObject({ reporter: 'amina', reported: 'chika', reason: 'abuse', note: 'Insulting me', status: 'open', match_id: matchId })
    expect(report.context.map((m: Json) => [m.from, m.body])).toEqual([
      [users.chika, 'you are terrible'],
      [users.amina, '😢'],
    ])
  })

  it('an admin can call the match off: both stakes go back, once', async () => {
    expect(await wallet('amina')).toEqual({ bonus: 900, cash: 250 })
    expect(await service(`public.admin_abort_match($1, $2, 'no')`, [users.boss, matchId])).toEqual({ ok: false, code: 'REASON_REQUIRED' })
    expect(await service(`public.admin_abort_match($1, $2, 'Reported abuse, game voided')`, [users.boss, matchId])).toEqual({ ok: true })
    expect(await service(`public.admin_abort_match($1, $2, 'Reported abuse, game voided')`, [users.boss, matchId])).toEqual({ ok: false, code: 'MATCH_NOT_ACTIVE' })
    expect(await wallet('amina')).toEqual({ bonus: 1000, cash: 250 })
    expect(await wallet('chika')).toEqual({ bonus: 1000, cash: 0 })

    const detail = await service(`public.admin_match($1)`, [matchId])
    expect(detail).toMatchObject({ status: 'aborted', end_reason: 'admin_abort', settled: true, stake_amount: 100 })
    expect(detail.players.map((p: Json) => p.username).sort()).toEqual(['amina', 'chika'])
    expect(detail.escrow.every((e: Json) => e.status === 'refunded')).toBe(true)
    expect(detail.ledger.map((l: Json) => l.entry_type).sort()).toEqual(['stake', 'stake', 'stake_refund', 'stake_refund'])
    expect(detail.game.fen).toBeTruthy()
  })

  it('resolving a report closes it, once, and is logged', async () => {
    const id = (await service(`public.admin_reports('open', 10, 0)`)).rows[0].id
    expect(await service(`public.admin_resolve_report($1, $2, 'maybe', null)`, [users.boss, id])).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await service(`public.admin_resolve_report($1, $2, 'resolved', 'Warned the player')`, [users.boss, id])).toEqual({ ok: true })
    expect(await service(`public.admin_resolve_report($1, $2, 'dismissed', null)`, [users.boss, id])).toEqual({ ok: false, code: 'REPORT_NOT_OPEN' })
    expect((await service(`public.admin_reports('open', 10, 0)`)).total).toBe(0)
    const closed = (await service(`public.admin_reports('resolved', 10, 0)`)).rows[0]
    expect(closed).toMatchObject({ resolved_by: 'boss', resolution_note: 'Warned the player' })
    const audit = await service(`public.admin_audit(50, 0)`)
    expect(audit.rows[0]).toMatchObject({ action: 'report_resolved', admin: 'boss', target: 'chika' })
    expect(audit.total).toBe(audit.rows.length)
  })

  it('a report outside a match carries the private conversation between the two only', async () => {
    await as('chika', `public.send_friend_request('bayo')`)
    await as('bayo', `public.respond_friend_request($1, true)`, [users.chika])
    await as('chika', `public.send_direct_message($1, 'send me tokens or else')`, [users.bayo])
    expect(await as('bayo', `public.report_player($1, 'abuse', null, null)`, [users.chika])).toEqual({ ok: true })
    const report = (await service(`public.admin_reports('open', 10, 0)`)).rows[0]
    expect(report.context.map((m: Json) => m.body)).toEqual(['send me tokens or else'])
    expect(report.reports_against_player).toBe(2)
  })
})

describe('looking things up', () => {
  it('finds players by name or email and shows one in full', async () => {
    const byEmail = await service(`public.admin_search_players('amina@exam', 10, 0)`)
    expect(byEmail.rows.map((r: Json) => r.username)).toEqual(['amina'])
    expect(byEmail.rows[0]).toMatchObject({ email: 'amina@example.com', cash_balance: 250, bonus_balance: 1000, is_banned: false })
    expect((await service(`public.admin_search_players(null, 2, 0)`)).total).toBe(5)
    expect((await service(`public.admin_search_players(null, 2, 0)`)).rows).toHaveLength(2)

    const player = await service(`public.admin_player($1)`, [users.amina])
    expect(player).toMatchObject({ username: 'amina', email: 'amina@example.com', is_admin: false, cash_balance: 250, reports_made: 1 })
    expect(player.ledger[0]).toMatchObject({ entry_type: 'stake_refund' })
    expect(player.matches.length).toBeGreaterThan(0)
    expect(await service(`public.admin_player($1)`, ['00000000-0000-0000-0000-000000000000'])).toBeNull()
  })

  it('the overview, matches list, revenue and integrity views answer', async () => {
    const overview = await service(`public.admin_overview()`)
    expect(overview).toMatchObject({ players: 5, banned: 0, active_matches: 0, tokens_cash: 250, tokens_in_escrow: 0, open_reports: 1, integrity_problems: 0 })
    const matches = await service(`public.admin_matches('aborted', 10, 0)`)
    expect(matches.total).toBeGreaterThanOrEqual(3)
    expect(matches.rows[0].players).toMatch(/ vs /)
    const revenue = await service(`public.admin_revenue(7)`)
    expect(revenue).toHaveLength(7)
    expect(revenue[0].signups).toBe(5)
    expect(await service(`public.admin_integrity()`)).toEqual({ problems: [], alerts: [] })
  })
})
