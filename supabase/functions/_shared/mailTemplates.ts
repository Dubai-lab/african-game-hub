// The words of every email the hub sends itself, in each language, and the page they are set
// in. Kept apart from the sending so that they can be read, tested and changed on their own.
//
// Rules for anything written here: plain and honest, as on the site. No promise of income. No
// claim that tokens can be turned into money. Anything a player wrote is shown as text, never
// as markup.

export type MailTemplate = 'welcome' | 'support_received' | 'support_notice'
export type MailData = Record<string, unknown>
export type Rendered = { subject: string; html: string; text: string }
export type MailContext = { siteUrl: string; supportAddress: string }

const BRAND = 'African Game Hub'
const INDIGO = '#1f2a7a'
const GOLD = '#f5b700'
const INK = '#0d1130'

/** Makes text safe to put in a page: what a player typed is shown, never run. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
const text = (value: unknown) => String(value ?? '').trim()
const lang = (language: string): 'en' | 'fr' => (language === 'fr' ? 'fr' : 'en')

type Body = {
  subject: string
  heading: string
  /** Paragraphs of plain words. */
  paragraphs: string[]
  /** Something quoted back, set apart: the player's own message. */
  quote?: string
  /** One button. */
  action?: { label: string; url: string }
  /** Smaller words under everything else. */
  footnote?: string
}

/** The page every email is set in: a band of the hub's colours, the words, and who it is from. */
function page(body: Body, context: MailContext, language: 'en' | 'fr'): Rendered {
  const sign = language === 'fr' ? `L’équipe ${BRAND}` : `The ${BRAND} team`
  const contact = language === 'fr' ? `Une question ? Écrivez-nous : ${context.supportAddress}` : `A question? Write to us: ${context.supportAddress}`
  const paragraphs = body.paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${INK};">${escapeHtml(p)}</p>`).join('')
  const quote = body.quote
    ? `<p style="margin:0 0 16px;padding:12px 16px;border-left:4px solid ${GOLD};background:#eef0fa;font-size:15px;line-height:22px;color:${INK};white-space:pre-wrap;">${escapeHtml(body.quote)}</p>`
    : ''
  const action = body.action
    ? `<p style="margin:8px 0 24px;"><a href="${escapeHtml(body.action.url)}" style="display:inline-block;padding:14px 28px;background:${GOLD};color:${INK};font-size:16px;font-weight:bold;text-decoration:none;">${escapeHtml(body.action.label)}</a></p>`
    : ''
  const footnote = body.footnote ? `<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:#555b7a;">${escapeHtml(body.footnote)}</p>` : ''
  const html = `<!doctype html>
<html lang="${language}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(body.subject)}</title></head>
<body style="margin:0;padding:0;background:#eef0fa;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0fa;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;">
<tr><td style="background:${INDIGO};padding:20px 24px;border-bottom:6px solid ${GOLD};"><span style="font-size:20px;font-weight:bold;color:#ffffff;">${BRAND}</span></td></tr>
<tr><td style="padding:28px 24px 8px;">
<h1 style="margin:0 0 20px;font-size:24px;line-height:30px;color:${INDIGO};">${escapeHtml(body.heading)}</h1>
${paragraphs}${quote}${action}${footnote}
<p style="margin:0 0 24px;font-size:16px;line-height:24px;color:${INK};">${escapeHtml(sign)}</p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #c5cbf2;font-size:13px;line-height:20px;color:#555b7a;">${escapeHtml(contact)}<br>${escapeHtml(context.siteUrl.replace(/^https?:\/\//, ''))}</td></tr>
</table>
</td></tr></table>
</body>
</html>`
  const plain = [body.heading, '', ...body.paragraphs.flatMap((p) => [p, '']), ...(body.quote ? [body.quote.split('\n').map((line) => `> ${line}`).join('\n'), ''] : []), ...(body.action ? [`${body.action.label}: ${body.action.url}`, ''] : []), ...(body.footnote ? [body.footnote, ''] : []), sign, '', contact].join('\n')
  return { subject: body.subject, html, text: plain }
}

const CATEGORY: Record<'en' | 'fr', Record<string, string>> = {
  en: { account: 'My account', game: 'A game', tokens: 'Tokens', bug: 'Something is not working', other: 'Something else' },
  fr: { account: 'Mon compte', game: 'Une partie', tokens: 'Jetons', bug: 'Quelque chose ne marche pas', other: 'Autre chose' },
}

/** The words of one email. Throws for a template it does not know, so nothing empty is ever sent. */
export function renderMail(template: MailTemplate, language: string, data: MailData, context: MailContext): Rendered {
  const l = lang(language)
  const name = text(data.name) || (l === 'fr' ? 'joueur' : 'player')
  if (template === 'welcome') {
    return page(
      l === 'fr'
        ? {
            subject: `Bienvenue sur ${BRAND}`,
            heading: `Bienvenue, ${name}`,
            paragraphs: [
              'Votre compte est confirmé. Vos jetons de bienvenue vous attendent dans votre portefeuille.',
              'Jouez aux échecs, au ludo, aux dames, au billard, à Check Up et à Word Battle contre de vrais joueurs de toute l’Afrique. Ajoutez vos amis et défiez-les.',
              'Astuce : ouvrez le site sur votre téléphone et ajoutez-le à votre écran d’accueil. Il s’ouvre alors comme une application.',
            ],
            action: { label: 'Jouer maintenant', url: `${context.siteUrl}/lobby` },
            footnote: 'Les jetons sont de la monnaie de jeu : ils ne peuvent pas être achetés ni retirés pour le moment. Réservé aux 18 ans et plus. Jouez de façon responsable.',
          }
        : {
            subject: `Welcome to ${BRAND}`,
            heading: `Welcome, ${name}`,
            paragraphs: [
              'Your account is confirmed. Your welcome tokens are waiting in your wallet.',
              'Play chess, ludo, draughts, pool, Check Up and Word Battle against real players across Africa. Add your friends and challenge them.',
              'A tip: open the site on your phone and add it to your Home screen. It then opens like an app.',
            ],
            action: { label: 'Play now', url: `${context.siteUrl}/lobby` },
            footnote: 'Tokens are play money: they cannot be bought or cashed out for now. For players aged 18 and over. Please play responsibly.',
          },
      context,
      l,
    )
  }
  if (template === 'support_received') {
    const reference = text(data.reference)
    return page(
      l === 'fr'
        ? {
            subject: `Nous avons bien reçu votre message (n° ${reference})`,
            heading: 'Nous avons bien reçu votre message',
            paragraphs: [
              `Bonjour ${name},`,
              `Merci de nous avoir écrit. Votre message porte le numéro ${reference} et notre équipe l’examine.`,
              'Nous vous répondrons sous 2 à 3 jours ouvrables. Si vous avez autre chose à ajouter, répondez simplement à cet e-mail.',
              'Voici ce que vous nous avez écrit :',
            ],
            quote: text(data.message),
          }
        : {
            subject: `We have received your report (no. ${reference})`,
            heading: 'We have received your report',
            paragraphs: [
              `Hello ${name},`,
              `Thank you for writing to us. Your report is number ${reference} and our team is looking into it.`,
              'We will get back to you within 2 to 3 working days. If you have anything to add, simply reply to this email.',
              'This is what you wrote to us:',
            ],
            quote: text(data.message),
          },
      context,
      l,
    )
  }
  if (template === 'support_notice') {
    // To our own team, always in English.
    return page(
      {
        subject: `[Support #${text(data.reference)}] ${CATEGORY.en[text(data.category)] ?? text(data.category)}: ${name}`,
        heading: `Report no. ${text(data.reference)}`,
        paragraphs: [
          `From: ${name} <${text(data.email)}>`,
          `About: ${CATEGORY.en[text(data.category)] ?? text(data.category)}`,
          `Page: ${text(data.page) || 'not given'}`,
          `Device: ${text(data.device) || 'not given'}`,
          `Player id: ${text(data.user_id)}`,
          'Reply to this email to answer the player directly. They have been told to expect an answer within 2 to 3 working days.',
        ],
        quote: text(data.message),
      },
      context,
      'en',
    )
  }
  throw new Error(`Unknown email template: ${String(template)}`)
}
