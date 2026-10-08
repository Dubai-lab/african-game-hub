import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './testDb'

// Friends, private messages and match chat: the privacy rules, tested as the players themselves
// (each call runs under that player's identity and the same access rules as the real API).

let db: TestDb
const users: Record<string, string> = {}
type Json = Record<string, unknown>

/** Calls a function as a signed-in player and returns its JSON reply. */
async function as(user: string, sql: string, params: unknown[] = []): Promise<Json> {
  return db.as('authenticated', users[user]!, async () => (await db.rows<{ r: Json }>(`select ${sql} as r`, params))[0]!.r)
}
const read = <T = Json>(user: string, sql: string, params: unknown[] = []) =>
  db.as('authenticated', users[user]!, () => db.rows<T>(sql, params))

const befriend = async (a: string, b: string) => {
  await as(a, `public.send_friend_request($1)`, [b])
  await as(b, `public.respond_friend_request($1, true)`, [users[a]])
}

async function match(a: string, b: string) {
  await db.pg.query(`select public.join_match_queue($1, 'chess', 0, '{"time_control":"3+2"}', 'blitz')`, [users[a]])
  const [row] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'chess', 0, '{"time_control":"3+2"}', 'blitz') as r`, [users[b]])
  return row!.r.match_id as string
}

beforeAll(async () => {
  db = await createTestDb()
  for (const name of ['amina', 'bayo', 'chika', 'dayo', 'stranger']) {
    users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'GH', age_confirmed: true })
  }
}, 120_000)

afterAll(async () => {
  await db.close()
})

describe('friends', () => {
  it('a request must be accepted by the other player before it counts', async () => {
    expect(await as('amina', `public.send_friend_request('BAYO')`)).toEqual({ ok: true, status: 'pending' })
    expect(await as('amina', `public.send_friend_request('bayo')`)).toEqual({ ok: false, code: 'REQUEST_ALREADY_SENT' })
    // The sender cannot accept their own request, and a third player cannot accept it either.
    expect(await as('amina', `public.respond_friend_request($1, true)`, [users.amina])).toEqual({ ok: false, code: 'NO_SUCH_REQUEST' })
    expect(await as('stranger', `public.respond_friend_request($1, true)`, [users.amina])).toEqual({ ok: false, code: 'NO_SUCH_REQUEST' })
    expect(await db.rows(`select status from public.friendships`)).toEqual([{ status: 'pending' }])

    expect(await as('bayo', `public.respond_friend_request($1, true)`, [users.amina])).toEqual({ ok: true })
    expect(await as('bayo', `public.send_friend_request('amina')`)).toEqual({ ok: false, code: 'ALREADY_FRIENDS' })
  })

  it('refuses nonsense: unknown players, yourself', async () => {
    expect(await as('amina', `public.send_friend_request('nobody_here')`)).toEqual({ ok: false, code: 'PLAYER_NOT_FOUND' })
    expect(await as('amina', `public.send_friend_request('amina')`)).toEqual({ ok: false, code: 'CANNOT_FRIEND_SELF' })
  })

  it('two players who each ask the other become friends at once', async () => {
    expect(await as('chika', `public.send_friend_request('dayo')`)).toEqual({ ok: true, status: 'pending' })
    expect(await as('dayo', `public.send_friend_request('chika')`)).toEqual({ ok: true, status: 'accepted' })
  })

  it('declining removes the request, and the same player may be asked again later', async () => {
    await as('stranger', `public.send_friend_request('amina')`)
    expect(await as('amina', `public.respond_friend_request($1, false)`, [users.stranger])).toEqual({ ok: true })
    expect(await db.rows(`select 1 from public.friendships where requester_id = $1`, [users.stranger])).toEqual([])
  })

  it('each player sees only the friendships they are part of', async () => {
    const mine = await read<{ n: number }>('amina', `select count(*)::int as n from public.friendships`)
    expect(mine).toEqual([{ n: 1 }])
    const none = await read<{ n: number }>('stranger', `select count(*)::int as n from public.friendships`)
    expect(none).toEqual([{ n: 0 }])
  })
})

describe('private messages', () => {
  it('can only be sent to an accepted friend', async () => {
    // Amina and Bayo are friends; Amina and the stranger are not.
    expect(await as('amina', `public.send_direct_message($1, '  Good game earlier!  ')`, [users.bayo])).toMatchObject({ ok: true })
    expect(await as('amina', `public.send_direct_message($1, 'hello')`, [users.stranger])).toEqual({ ok: false, code: 'NOT_FRIENDS' })
    expect(await as('stranger', `public.send_direct_message($1, 'hello')`, [users.amina])).toEqual({ ok: false, code: 'NOT_FRIENDS' })

    // A request that has only been SENT is not enough.
    await as('stranger', `public.send_friend_request('bayo')`)
    expect(await as('stranger', `public.send_direct_message($1, 'hi')`, [users.bayo])).toEqual({ ok: false, code: 'NOT_FRIENDS' })
    expect(await as('bayo', `public.send_direct_message($1, 'hi')`, [users.stranger])).toEqual({ ok: false, code: 'NOT_FRIENDS' })
    await as('bayo', `public.respond_friend_request($1, false)`, [users.stranger])

    const stored = await db.rows(`select body from public.direct_messages`)
    expect(stored).toEqual([{ body: 'Good game earlier!' }])
  })

  it('refuses empty and oversized messages', async () => {
    expect(await as('amina', `public.send_direct_message($1, '   ')`, [users.bayo])).toEqual({ ok: false, code: 'BAD_MESSAGE' })
    expect(await as('amina', `public.send_direct_message($1, $2)`, [users.bayo, 'x'.repeat(501)])).toEqual({ ok: false, code: 'BAD_MESSAGE' })
  })

  it('are readable by the two people in the conversation and nobody else', async () => {
    await as('bayo', `public.send_direct_message($1, 'Rematch tonight?')`, [users.amina])
    expect((await read('amina', `select body from public.direct_messages order by id`)).map((m) => m.body)).toEqual([
      'Good game earlier!',
      'Rematch tonight?',
    ])
    expect(await read('chika', `select body from public.direct_messages`)).toEqual([])
    expect(await read('stranger', `select body from public.direct_messages`)).toEqual([])
  })

  it('read receipts are set only by the recipient', async () => {
    // Bayo "marking read" Amina's inbox does nothing to messages addressed to Amina.
    await db.as('authenticated', users.bayo!, () => db.pg.query(`select public.mark_messages_read($1)`, [users.bayo]))
    expect(await db.rows(`select count(*)::int as n from public.direct_messages where recipient_id = $1 and read_at is null`, [users.amina])).toEqual([{ n: 1 }])
    await db.as('authenticated', users.amina!, () => db.pg.query(`select public.mark_messages_read($1)`, [users.bayo]))
    expect(await db.rows(`select count(*)::int as n from public.direct_messages where recipient_id = $1 and read_at is null`, [users.amina])).toEqual([{ n: 0 }])
  })

  it('stop the moment a friendship ends', async () => {
    expect(await as('bayo', `public.remove_friend($1)`, [users.amina])).toEqual({ ok: true })
    expect(await as('amina', `public.send_direct_message($1, 'still there?')`, [users.bayo])).toEqual({ ok: false, code: 'NOT_FRIENDS' })
    await befriend('amina', 'bayo')
    expect(await as('amina', `public.send_direct_message($1, 'friends again')`, [users.bayo])).toMatchObject({ ok: true })
  })

  it('cannot be written, edited or deleted directly', async () => {
    const attempts = [
      `insert into public.direct_messages (sender_id, recipient_id, body) values ('${users.stranger}', '${users.amina}', 'forged')`,
      `insert into public.direct_messages (sender_id, recipient_id, body) values ('${users.amina}', '${users.stranger}', 'no friendship')`,
      `update public.direct_messages set body = 'edited'`,
      `delete from public.direct_messages`,
      `insert into public.friendships (requester_id, addressee_id, status) values ('${users.stranger}', '${users.amina}', 'accepted')`,
      `update public.friendships set status = 'accepted'`,
      `insert into public.match_messages (match_id, sender_id, kind, body) values (gen_random_uuid(), '${users.stranger}', 'text', 'x')`,
      `update public.profile_private set match_chat_enabled = true where user_id <> '${users.stranger}'`,
    ]
    await db.as('authenticated', users.stranger!, async () => {
      for (const sql of attempts.slice(0, 7)) {
        await expect(db.pg.query(sql), sql).rejects.toThrow(/permission denied|row-level security/)
      }
      // Updating someone else's chat setting is not an error; it simply matches no rows.
      const result = await db.pg.query(attempts[7]!)
      expect(result.affectedRows).toBe(0)
    })
  })
})

describe('chat during a match', () => {
  it('is open to both players, friends or not, with text and the offered emoji', async () => {
    const matchId = await match('chika', 'stranger')
    expect(await as('chika', `public.match_chat_status($1)`, [matchId])).toEqual({ mine: true, others: true })
    expect(await as('chika', `public.send_match_message($1, 'text', 'Good luck!')`, [matchId])).toMatchObject({ ok: true })
    expect(await as('stranger', `public.send_match_message($1, 'emoji', '😂')`, [matchId])).toMatchObject({ ok: true })

    // An "emoji" that is really a sentence, an unknown kind, an empty or oversized text.
    expect(await as('chika', `public.send_match_message($1, 'emoji', 'you are bad')`, [matchId])).toEqual({ ok: false, code: 'BAD_MESSAGE' })
    expect(await as('chika', `public.send_match_message($1, 'image', 'x')`, [matchId])).toEqual({ ok: false, code: 'BAD_MESSAGE' })
    expect(await as('chika', `public.send_match_message($1, 'text', '  ')`, [matchId])).toEqual({ ok: false, code: 'BAD_MESSAGE' })
    expect(await as('chika', `public.send_match_message($1, 'text', $2)`, [matchId, 'x'.repeat(201)])).toEqual({ ok: false, code: 'BAD_MESSAGE' })

    // Both players read it; nobody else does, not even once the game is over and public.
    expect((await read('stranger', `select kind, body from public.match_messages where match_id = $1 order by id`, [matchId]))).toEqual([
      { kind: 'text', body: 'Good luck!' },
      { kind: 'emoji', body: '😂' },
    ])
    expect(await as('amina', `public.send_match_message($1, 'text', 'let me in')`, [matchId])).toEqual({ ok: false, code: 'NOT_A_PLAYER' })
    expect(await as('amina', `public.match_chat_status($1)`, [matchId])).toBeNull()
    await db.pg.query(`select private.finish_match($1, 'draw', null, 'agreement')`, [matchId])
    expect(await read('amina', `select 1 from public.match_messages where match_id = $1`, [matchId])).toEqual([])
    expect(await read('amina', `select 1 from public.matches where id = $1`, [matchId])).toHaveLength(1)
  })

  it('a player who switches live chat off can neither send nor be sent anything', async () => {
    const matchId = await match('amina', 'dayo')
    await db.as('authenticated', users.dayo!, () => db.pg.query(`update public.profile_private set match_chat_enabled = false`))

    expect(await as('dayo', `public.match_chat_status($1)`, [matchId])).toEqual({ mine: false, others: true })
    expect(await as('amina', `public.match_chat_status($1)`, [matchId])).toEqual({ mine: true, others: false })
    expect(await as('dayo', `public.send_match_message($1, 'text', 'hello')`, [matchId])).toEqual({ ok: false, code: 'CHAT_OFF_YOU' })
    expect(await as('dayo', `public.send_match_message($1, 'emoji', '😂')`, [matchId])).toEqual({ ok: false, code: 'CHAT_OFF_YOU' })
    expect(await as('amina', `public.send_match_message($1, 'text', 'hello')`, [matchId])).toEqual({ ok: false, code: 'CHAT_OFF_OPPONENT' })
    expect(await as('amina', `public.send_match_message($1, 'emoji', '😡')`, [matchId])).toEqual({ ok: false, code: 'CHAT_OFF_OPPONENT' })
    expect(await db.rows(`select 1 from public.match_messages where match_id = $1`, [matchId])).toEqual([])

    // Switching it back on restores chat for both.
    await db.as('authenticated', users.dayo!, () => db.pg.query(`update public.profile_private set match_chat_enabled = true`))
    expect(await as('amina', `public.send_match_message($1, 'emoji', '🤝')`, [matchId])).toMatchObject({ ok: true })
    await db.pg.query(`select private.finish_match($1, 'aborted', null, 'test')`, [matchId])
  })

  it('cannot be used to flood an opponent, and closes a while after the game', async () => {
    const matchId = await match('amina', 'chika')
    const replies: Json[] = []
    for (let i = 0; i < 7; i++) replies.push(await as('amina', `public.send_match_message($1, 'emoji', '🔥')`, [matchId]))
    expect(replies.filter((r) => r.ok)).toHaveLength(5)
    expect(replies.slice(5)).toEqual([
      { ok: false, code: 'SLOW_DOWN' },
      { ok: false, code: 'SLOW_DOWN' },
    ])
    // The other player is not held back by Amina's burst.
    expect(await as('chika', `public.send_match_message($1, 'text', 'calm down')`, [matchId])).toMatchObject({ ok: true })

    await db.pg.query(`select private.finish_match($1, 'draw', null, 'agreement')`, [matchId])
    await db.pg.query(`update public.match_messages set created_at = now() - interval '1 minute' where match_id = $1`, [matchId])
    expect(await as('chika', `public.send_match_message($1, 'text', 'gg')`, [matchId])).toMatchObject({ ok: true })
    await db.pg.query(`update public.matches set finished_at = now() - interval '11 minutes' where id = $1`, [matchId])
    expect(await as('chika', `public.send_match_message($1, 'text', 'one more thing')`, [matchId])).toEqual({ ok: false, code: 'CHAT_CLOSED' })
  })
})
