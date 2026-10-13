import { describe, expect, it } from 'vitest'
import { type MailTemplate, renderMail } from '../../../supabase/functions/_shared/mailTemplates'
import { pushWords } from '../../../supabase/functions/_shared/notificationWords'
import en from '../i18n/locales/en.json'
import fr from '../i18n/locales/fr.json'

// What the hub says when it writes to a player by itself: the emails about their account and
// from our team, and the few words of a notification on their phone.

const context = { siteUrl: 'https://africangamehub.com', supportAddress: 'support@africangamehub.com' }

describe('the emails about a player’s account and from our team', () => {
  it('the answer to a report carries the answer, the number, and what the player had written', () => {
    const data = { name: 'Kofi', reference: 17, message: 'My tokens did not come back.', reply: 'Your 50 tokens are back in your wallet.\nSorry for the trouble.' }
    const mail = renderMail('support_answered', 'en', data, context)
    expect(mail.subject).toContain('17')
    expect(mail.text).toContain('Your 50 tokens are back in your wallet.')
    expect(mail.text).toContain('Sorry for the trouble.')
    expect(mail.text).toContain('My tokens did not come back.')
    expect(mail.html).toContain('Your 50 tokens are back in your wallet.')
    const french = renderMail('support_answered', 'fr', data, context)
    expect(french.subject).toContain('17')
    expect(french.subject).not.toBe(mail.subject)
  })

  it('a suspension gives the reason and how to reach us; a restoration leads back to the hub', () => {
    const suspended = renderMail('account_suspended', 'en', { name: 'Musa', reason: 'Several accounts' }, context)
    expect(suspended.text).toContain('Several accounts')
    expect(suspended.text).toContain('support@africangamehub.com')
    const restored = renderMail('account_restored', 'en', { name: 'Musa' }, context)
    expect(restored.html).toContain('https://africangamehub.com')
    expect(renderMail('account_suspended', 'fr', { name: 'Musa', reason: 'x' }, context).subject).not.toBe(suspended.subject)
  })

  it('a changed password tells the player what to do if it was not them', () => {
    const mail = renderMail('password_changed', 'en', { name: 'Nia' }, context)
    expect(mail.text).toContain('Nia')
    expect(mail.text).toContain('support@africangamehub.com')
  })

  it('an announcement is our team’s own title and words, and says how to stop such emails', () => {
    const mail = renderMail('announcement', 'en', { name: 'Hawa', title: 'A new game', body: 'Word Battle is now on the hub.\n\nCome and play.' }, context)
    expect(mail.subject).toBe('A new game')
    expect(mail.text).toContain('Word Battle is now on the hub.')
    expect(mail.text).toContain('Come and play.')
    expect(mail.text.toLowerCase()).toContain('settings')
    expect(renderMail('announcement', 'fr', { name: 'Hawa', title: 'Un nouveau jeu', body: 'Word Battle est arrivé sur le hub.' }, context).text.toLowerCase()).toContain('réglages')
  })

  it('nothing typed by a player or by our team is ever run as markup', () => {
    const nasty = '<script>alert(1)</script><img src=x onerror=alert(2)>'
    const all: [MailTemplate, Record<string, unknown>][] = [
      ['support_answered', { name: nasty, reference: 1, message: nasty, reply: nasty }],
      ['account_suspended', { name: nasty, reason: nasty }],
      ['account_restored', { name: nasty }],
      ['password_changed', { name: nasty }],
      ['announcement', { name: nasty, title: nasty, body: nasty }],
    ]
    for (const [template, data] of all) {
      for (const language of ['en', 'fr']) {
        const { html } = renderMail(template, language, data, context)
        expect(html, `${template} ${language}`).not.toContain('<script>')
        expect(html, `${template} ${language}`).not.toContain('<img src=x')
      }
    }
  })
})

describe('the words of a notification on a phone', () => {
  it('each kind has a title, a line, and a place in the app to open', () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ['friend_request', { username: 'amina' }, '/friends'],
      ['friend_accepted', { username: 'amina' }, '/friends'],
      ['challenge', { username: 'amina', game: 'ludo', challenge_id: 'abc' }, '/challenge/abc'],
      ['tournament_started', { name: 'Friday Cup', tournament_id: 'xyz' }, '/tournaments/xyz'],
      ['support_answered', { reference: 3 }, '/support'],
      ['announcement', { title: 'A new game', body: 'Word Battle is now on the hub.' }, '/lobby'],
    ]
    for (const [kind, data, url] of cases) {
      for (const language of ['en', 'fr', 'sw']) {
        const words = pushWords(kind, data, language)
        expect(words, kind).not.toBeNull()
        expect(words!.title.length, kind).toBeGreaterThan(0)
        expect(words!.body.length, kind).toBeGreaterThan(0)
        expect(words!.url, kind).toBe(url)
        expect(words!.tag.length, kind).toBeGreaterThan(0)
      }
    }
    expect(pushWords('challenge', { username: 'amina', game: 'ludo' }, 'en')!.body).toBe('amina challenges you to Ludo.')
    expect(pushWords('challenge', { username: 'amina', game: 'draughts' }, 'fr')!.body).toBe('amina vous défie : Dames.')
  })

  it('a kind nobody has written says nothing; a long announcement is cut short', () => {
    expect(pushWords('something_new', {}, 'en')).toBeNull()
    const long = pushWords('announcement', { title: 't'.repeat(200), body: 'b'.repeat(500) }, 'en')!
    expect(long.title.length).toBeLessThanOrEqual(60)
    expect(long.body.length).toBeLessThanOrEqual(140)
  })

  it('the app has its own words for every kind the database can write, in both languages', () => {
    for (const kind of ['friend_request', 'friend_accepted', 'challenge', 'tournament_started', 'support_answered', 'other']) {
      expect((en.notifications.kind as Record<string, string>)[kind], kind).toBeTruthy()
      expect((fr.notifications.kind as Record<string, string>)[kind], kind).toBeTruthy()
    }
  })
})
