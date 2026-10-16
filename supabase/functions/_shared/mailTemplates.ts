// The words of every email the hub sends itself, in each language, and the page they are set
// in. Kept apart from the sending so that they can be read, tested and changed on their own.
//
// Rules for anything written here: plain and honest, as on the site. No promise of income. No
// claim that tokens can be turned into money. Anything a player wrote is shown as text, never
// as markup.

export type MailTemplate = 'welcome' | 'support_received' | 'support_notice' | 'support_answered' | 'account_suspended' | 'account_restored' | 'password_changed' | 'announcement' | 'promotion_won'
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
/** 1st, 2nd, 3rd, 4th, 11th, 21st... */
const ordinal = (n: number) => {
  const tens = n % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}

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
  if (template === 'support_answered') {
    const reference = text(data.reference)
    return page(
      l === 'fr'
        ? {
            subject: `Réponse à votre message (n° ${reference})`,
            heading: 'Notre réponse à votre message',
            paragraphs: [`Bonjour ${name},`, `Voici notre réponse à votre message n° ${reference} :`],
            quote: text(data.reply),
            footnote: `Vous nous aviez écrit : « ${text(data.message)} » Si le problème continue, répondez à cet e-mail.`,
          }
        : {
            subject: `Our answer to your report (no. ${reference})`,
            heading: 'Our answer to your report',
            paragraphs: [`Hello ${name},`, `Here is our answer to your report number ${reference}:`],
            quote: text(data.reply),
            footnote: `You wrote to us: "${text(data.message)}" If the problem continues, reply to this email.`,
          },
      context,
      l,
    )
  }
  if (template === 'account_suspended') {
    return page(
      l === 'fr'
        ? {
            subject: 'Votre compte a été suspendu',
            heading: 'Votre compte a été suspendu',
            paragraphs: [`Bonjour ${name},`, 'Notre équipe a suspendu votre compte. Vous ne pouvez pas jouer en ligne pour le moment.', 'La raison donnée :'],
            quote: text(data.reason),
            footnote: 'Si vous pensez qu’il s’agit d’une erreur, répondez à cet e-mail et expliquez-nous pourquoi. Nous examinerons votre demande.',
          }
        : {
            subject: 'Your account has been suspended',
            heading: 'Your account has been suspended',
            paragraphs: [`Hello ${name},`, 'Our team has suspended your account. You cannot play online for now.', 'The reason given:'],
            quote: text(data.reason),
            footnote: 'If you think this is a mistake, reply to this email and tell us why. We will look at it again.',
          },
      context,
      l,
    )
  }
  if (template === 'account_restored') {
    return page(
      l === 'fr'
        ? {
            subject: 'Votre compte est de nouveau actif',
            heading: 'Votre compte est de nouveau actif',
            paragraphs: [`Bonjour ${name},`, 'Notre équipe a rétabli votre compte. Vous pouvez de nouveau jouer en ligne.'],
            action: { label: 'Jouer', url: `${context.siteUrl}/lobby` },
          }
        : {
            subject: 'Your account is active again',
            heading: 'Your account is active again',
            paragraphs: [`Hello ${name},`, 'Our team has restored your account. You can play online again.'],
            action: { label: 'Play', url: `${context.siteUrl}/lobby` },
          },
      context,
      l,
    )
  }
  if (template === 'password_changed') {
    return page(
      l === 'fr'
        ? {
            subject: 'Votre mot de passe a été modifié',
            heading: 'Votre mot de passe a été modifié',
            paragraphs: [`Bonjour ${name},`, 'Le mot de passe de votre compte vient d’être modifié.', 'Si c’était vous, vous n’avez rien à faire.'],
            footnote: 'Si ce n’était pas vous, répondez tout de suite à cet e-mail : quelqu’un d’autre a peut-être accès à votre compte.',
          }
        : {
            subject: 'Your password was changed',
            heading: 'Your password was changed',
            paragraphs: [`Hello ${name},`, 'The password of your account has just been changed.', 'If that was you, there is nothing to do.'],
            footnote: 'If it was not you, reply to this email at once: someone else may have access to your account.',
          },
      context,
      l,
    )
  }
  if (template === 'announcement') {
    // Our team's own words, as they wrote them (in one language): one paragraph for each line.
    const lines = text(data.body).split(/\n+/).map((line) => line.trim()).filter(Boolean)
    return page(
      {
        subject: text(data.title),
        heading: text(data.title),
        paragraphs: [l === 'fr' ? `Bonjour ${name},` : `Hello ${name},`, ...lines],
        action: { label: l === 'fr' ? 'Ouvrir African Game Hub' : 'Open African Game Hub', url: `${context.siteUrl}/lobby` },
        footnote:
          l === 'fr'
            ? 'Vous recevez cet e-mail parce que vous avez un compte African Game Hub. Pour ne plus recevoir nos nouvelles, ouvrez Réglages dans l’application et désactivez « E-mails de nouvelles ».'
            : 'You are receiving this because you have an African Game Hub account. To stop our news emails, open Settings in the app and switch off "News emails".',
      },
      context,
      l,
    )
  }
  if (template === 'promotion_won') {
    // A winner of a promotion: their place, the prize, and what to send us to receive it.
    const promotion = text(data.promotion)
    const prize = text(data.prize)
    const place = Number(data.place)
    const placeWords = l === 'fr' ? (place === 1 ? '1re' : `${place}e`) : ordinal(place)
    const note = text(data.note)
    return page(
      l === 'fr'
        ? {
            subject: `Félicitations, vous avez gagné : ${promotion}`,
            heading: 'Félicitations, vous avez gagné !',
            paragraphs: [
              `Bonjour ${name},`,
              `Vous avez terminé à la ${placeWords} place de notre promotion « ${promotion} » et vous avez gagné : ${prize}.`,
              'Pour recevoir votre prix, répondez à cet e-mail en nous indiquant :',
              '1. le numéro mobile money sur lequel envoyer le prix, avec l’indicatif du pays ;',
              '2. le nom complet enregistré sur ce compte mobile money ;',
              '3. le réseau (par exemple MTN MoMo ou Airtel Money).',
            ],
            ...(note ? { quote: note } : {}),
            footnote:
              'Nous ne vous demanderons jamais votre mot de passe ni votre code PIN. Ne répondez qu’à cet e-mail, et n’envoyez votre numéro à personne d’autre qui dirait venir de notre part.',
          }
        : {
            subject: `Congratulations, you won: ${promotion}`,
            heading: 'Congratulations, you won!',
            paragraphs: [
              `Hello ${name},`,
              `You finished in ${placeWords} place in our promotion "${promotion}" and you have won: ${prize}.`,
              'To receive your prize, reply to this email with:',
              '1. the mobile money number the prize should be sent to, with its country code;',
              '2. the full name registered on that mobile money account;',
              '3. the network (for example MTN MoMo or Airtel Money).',
            ],
            ...(note ? { quote: note } : {}),
            footnote:
              'We will never ask for your password or a PIN. Only reply to this email, and do not send your number to anyone else who says they are from us.',
          },
      context,
      l,
    )
  }
  throw new Error(`Unknown email template: ${String(template)}`)
}
