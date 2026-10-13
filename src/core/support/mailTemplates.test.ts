import { describe, expect, it } from 'vitest'
import { escapeHtml, renderMail } from '../../../supabase/functions/_shared/mailTemplates'

// The words of the hub's own emails: that each says what it must, in each language, and that
// nothing a player typed can ever be run as markup in someone's inbox.

const context = { siteUrl: 'https://africangamehub.com', supportAddress: 'support@africangamehub.com' }

describe('the welcome email', () => {
  it('greets the player by name, leads to the lobby, and makes no promise about money', () => {
    const mail = renderMail('welcome', 'en', { name: 'Amina' }, context)
    expect(mail.subject).toBe('Welcome to African Game Hub')
    expect(mail.text).toContain('Welcome, Amina')
    expect(mail.html).toContain('href="https://africangamehub.com/lobby"')
    expect(mail.text).toContain('Tokens are play money')
    expect(mail.text).toContain('18 and over')
    for (const word of ['earn', 'income', 'rich', 'cash out today', 'win money']) expect(mail.text.toLowerCase()).not.toContain(word)
  })

  it('is in French for a player who reads French, and in English for a language it has no words in', () => {
    expect(renderMail('welcome', 'fr', { name: 'Awa' }, context).subject).toBe('Bienvenue sur African Game Hub')
    expect(renderMail('welcome', 'fr', { name: 'Awa' }, context).text).toContain('Bienvenue, Awa')
    expect(renderMail('welcome', 'sw', { name: 'Juma' }, context).subject).toBe('Welcome to African Game Hub')
  })
})

describe('the answer to a report', () => {
  const data = { name: 'Chidi', reference: 42, category: 'tokens', message: 'My tokens did not come back.\nPlease look.' }

  it('gives the number of the report, says when to expect an answer, and quotes what was written', () => {
    const mail = renderMail('support_received', 'en', data, context)
    expect(mail.subject).toBe('We have received your report (no. 42)')
    expect(mail.text).toContain('within 2 to 3 working days')
    expect(mail.text).toContain('> My tokens did not come back.\n> Please look.')
    expect(mail.html).toContain('My tokens did not come back.')
    expect(renderMail('support_received', 'fr', data, context).text).toContain('sous 2 à 3 jours ouvrables')
  })

  it('what the player typed is shown as text, never as markup', () => {
    const mail = renderMail('support_received', 'en', { ...data, name: '<b>Eve</b>', message: '<script>alert(1)</script><img src=x onerror=alert(2)> "quoted" & more' }, context)
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).not.toContain('<img')
    expect(mail.html).not.toContain('<b>Eve</b>')
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(mail.html).toContain('&quot;quoted&quot; &amp; more')
    expect(escapeHtml(`<a href='x'>`)).toBe('&lt;a href=&#39;x&#39;&gt;')
  })
})

describe('the notice to our own team', () => {
  it('says who wrote, about what, from where, and that the player has been told when to expect an answer', () => {
    const mail = renderMail('support_notice', 'en', { name: 'Chidi', reference: 42, category: 'bug', message: 'The board froze.', email: 'chidi@example.com', page: '/play/chess', device: 'Android phone', user_id: 'abc-123' }, context)
    expect(mail.subject).toBe('[Support #42] Something is not working: Chidi')
    for (const part of ['From: Chidi <chidi@example.com>', 'Page: /play/chess', 'Device: Android phone', 'Player id: abc-123', '> The board froze.', '2 to 3 working days']) expect(mail.text).toContain(part)
    expect(mail.html).toContain('Chidi &lt;chidi@example.com&gt;')
  })
})

describe('an email of a kind nobody has written', () => {
  it('is never sent empty: it is an error', () => {
    expect(() => renderMail('nonsense' as never, 'en', {}, context)).toThrow(/Unknown email template/)
  })
})
