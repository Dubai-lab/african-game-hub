// The emails the hub sends about an account, in the hub's own look and words, in English or
// French according to the language the player signed up in.
//
// Usage: npm run email:push               (the live project)
//        npm run on-dev -- email:push     (the development project)
//        npm run email:push -- --preview  (writes the emails to email-preview/ and sends nothing)
//
// Supabase's auth server sends these; this script only gives it the wording and the layout.
// The parts in {{ }} are filled in by that server for each email:
//   {{ .ConfirmationURL }}   the link the player must open
//   {{ .Email }}             the player's address
//   {{ .Data.preferred_language }}  what the player chose when signing up ("en", "fr")
//
// Written for email programs, which understand far less than a browser: tables for layout, every
// style written on its element, no pictures (most programs hide them until asked), and nothing
// that needs a font to be downloaded.
import { mkdirSync, writeFileSync } from 'node:fs'
import { managementFetch, requireEnv } from './lib/managementApi.ts'

const INK = '#0d1130'
const INDIGO = '#1f2a7a'
const MAIZE = '#f5b700'
const HIBISCUS = '#d1264f'
const PALM = '#0b7a55'
const LIMEWASH = '#eef0fa'
const MUTED = '#4a5078'
const FONT = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

type Words = { heading: string; body: string; button?: string; small: string }
type Email = { subject: { en: string; fr: string }; en: Words; fr: Words }

/** French for a player who signed up in French; English for everyone else. */
const byLanguage = (en: string, fr: string) => `{{ if eq (printf "%v" .Data.preferred_language) "fr" }}${fr}{{ else }}${en}{{ end }}`

function layout(email: Email): string {
  const part = (pick: (words: Words) => string | undefined) => byLanguage(pick(email.en) ?? '', pick(email.fr) ?? '')
  const button = email.en.button
    ? `
          <tr>
            <td style="padding:8px 32px 8px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="${MAIZE}" style="border-radius:6px;">
                    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:15px 28px;font-family:${FONT};font-size:17px;font-weight:700;color:${INK};text-decoration:none;border-radius:6px;">${part((w) => w.button)}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 0 32px;font-family:${FONT};font-size:13px;line-height:20px;color:${MUTED};">
              ${byLanguage('If the button does not work, copy this address into your browser:', 'Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :')}<br>
              <a href="{{ .ConfirmationURL }}" style="color:${INDIGO};word-break:break-all;">{{ .ConfirmationURL }}</a>
            </td>
          </tr>`
    : ''
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
  </head>
  <body style="margin:0;padding:0;background-color:${LIMEWASH};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${LIMEWASH}">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border:2px solid ${INK};">
            <tr>
              <td bgcolor="${INDIGO}" style="padding:22px 32px;font-family:${FONT};font-size:22px;font-weight:800;letter-spacing:0.3px;color:#ffffff;">African Game Hub</td>
            </tr>
            <tr>
              <td style="padding:0;font-size:0;line-height:0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="40%" height="8" bgcolor="${MAIZE}" style="font-size:0;line-height:0;">&nbsp;</td>
                    <td width="20%" height="8" bgcolor="${HIBISCUS}" style="font-size:0;line-height:0;">&nbsp;</td>
                    <td width="20%" height="8" bgcolor="${PALM}" style="font-size:0;line-height:0;">&nbsp;</td>
                    <td width="20%" height="8" bgcolor="${LIMEWASH}" style="font-size:0;line-height:0;">&nbsp;</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 6px 32px;font-family:${FONT};font-size:24px;line-height:30px;font-weight:800;color:${INDIGO};">${part((w) => w.heading)}</td>
            </tr>
            <tr>
              <td style="padding:6px 32px 18px 32px;font-family:${FONT};font-size:16px;line-height:25px;color:${INK};">${part((w) => w.body)}</td>
            </tr>${button}
            <tr>
              <td style="padding:22px 32px 26px 32px;font-family:${FONT};font-size:13px;line-height:20px;color:${MUTED};">${part((w) => w.small)}</td>
            </tr>
            <tr>
              <td bgcolor="${LIMEWASH}" style="padding:16px 32px;border-top:2px solid ${INK};font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};">
                ${byLanguage('African Game Hub: skill games for players across Africa. For players aged 18 and over.', 'African Game Hub : des jeux d’adresse pour les joueurs de toute l’Afrique. Réservé aux joueurs de 18 ans et plus.')}<br>
                ${byLanguage('This email was sent to {{ .Email }} because of something asked for on our site. We will never ask for your password by email.', 'Cet e-mail a été envoyé à {{ .Email }} à la suite d’une demande faite sur notre site. Nous ne vous demanderons jamais votre mot de passe par e-mail.')}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

const EMAILS: Record<string, Email> = {
  confirmation: {
    subject: { en: 'Confirm your African Game Hub account', fr: 'Confirmez votre compte African Game Hub' },
    en: {
      heading: 'One tap and you are in',
      body: 'Welcome to African Game Hub. Confirm that this is your email address to finish creating your account. Your free tokens are waiting for you.',
      button: 'Confirm my email',
      small: 'The link works once. If you did not create an account, you can ignore this email and nothing will happen.',
    },
    fr: {
      heading: 'Un clic et vous y êtes',
      body: 'Bienvenue sur African Game Hub. Confirmez que cette adresse e-mail est bien la vôtre pour terminer la création de votre compte. Vos jetons gratuits vous attendent.',
      button: 'Confirmer mon e-mail',
      small: 'Le lien ne sert qu’une fois. Si vous n’avez pas créé de compte, ignorez cet e-mail : il ne se passera rien.',
    },
  },
  recovery: {
    subject: { en: 'Choose a new African Game Hub password', fr: 'Choisissez un nouveau mot de passe African Game Hub' },
    en: {
      heading: 'Choose a new password',
      body: 'Someone, we hope you, asked to reset the password of the African Game Hub account for this email address. Open the link to choose a new one.',
      button: 'Choose a new password',
      small: 'The link works once and for a limited time. If you did not ask for this, ignore this email: your password stays as it is, and nobody can change it without this link.',
    },
    fr: {
      heading: 'Choisissez un nouveau mot de passe',
      body: 'Quelqu’un, vous nous l’espérons, a demandé à changer le mot de passe du compte African Game Hub lié à cette adresse e-mail. Ouvrez le lien pour en choisir un nouveau.',
      button: 'Choisir un nouveau mot de passe',
      small: 'Le lien ne sert qu’une fois et pour une durée limitée. Si vous n’avez rien demandé, ignorez cet e-mail : votre mot de passe reste inchangé, et personne ne peut le modifier sans ce lien.',
    },
  },
  email_change: {
    subject: { en: 'Confirm your new email for African Game Hub', fr: 'Confirmez votre nouvel e-mail pour African Game Hub' },
    en: {
      heading: 'Confirm your new email address',
      body: 'You asked to use this email address for your African Game Hub account. Confirm it and it becomes the address you log in with.',
      button: 'Confirm this address',
      small: 'If you did not ask for this, ignore this email and your account keeps its current address.',
    },
    fr: {
      heading: 'Confirmez votre nouvelle adresse e-mail',
      body: 'Vous avez demandé à utiliser cette adresse e-mail pour votre compte African Game Hub. Confirmez-la et elle deviendra votre adresse de connexion.',
      button: 'Confirmer cette adresse',
      small: 'Si vous n’avez rien demandé, ignorez cet e-mail : votre compte garde son adresse actuelle.',
    },
  },
  // Sent after the fact, so there is no link to open: it is a notice, and a warning if it was not them.
  password_changed_notification: {
    subject: { en: 'Your African Game Hub password was changed', fr: 'Votre mot de passe African Game Hub a été changé' },
    en: {
      heading: 'Your password was changed',
      body: 'The password of the African Game Hub account for this email address has just been changed. Every other device was signed out.',
      small: 'If this was you, there is nothing to do. If it was not, open the site, choose "Forgot your password?" on the log-in page to set a new one at once, and tell us.',
    },
    fr: {
      heading: 'Votre mot de passe a été changé',
      body: 'Le mot de passe du compte African Game Hub lié à cette adresse e-mail vient d’être changé. Tous les autres appareils ont été déconnectés.',
      small: 'Si c’était vous, il n’y a rien à faire. Sinon, ouvrez le site, choisissez « Mot de passe oublié ? » sur la page de connexion pour en définir un nouveau tout de suite, et prévenez-nous.',
    },
  },
}

if (process.argv.includes('--preview')) {
  mkdirSync('email-preview', { recursive: true })
  for (const [name, email] of Object.entries(EMAILS)) {
    for (const language of ['en', 'fr'] as const) {
      // What the auth server would do with the {{ }} parts, near enough to look at.
      const html = layout(email)
        .replace(/\{\{ if eq \(printf "%v" \.Data\.preferred_language\) "fr" \}\}([\s\S]*?)\{\{ else \}\}([\s\S]*?)\{\{ end \}\}/g, (_all, fr: string, en: string) => (language === 'fr' ? fr : en))
        .replaceAll('{{ .ConfirmationURL }}', 'https://example.com/auth/v1/verify?token=EXAMPLE&type=signup')
        .replaceAll('{{ .Email }}', 'player@example.com')
      writeFileSync(`email-preview/${name}.${language}.html`, html)
    }
  }
  console.log(`Wrote ${Object.keys(EMAILS).length * 2} previews to email-preview/`)
  process.exit(0)
}

const settings: Record<string, unknown> = { mailer_notifications_password_changed_enabled: true }
for (const [name, email] of Object.entries(EMAILS)) {
  settings[`mailer_subjects_${name}`] = byLanguage(email.subject.en, email.subject.fr)
  settings[`mailer_templates_${name}_content`] = layout(email)
}
const res = await managementFetch('/config/auth', { method: 'PATCH', body: JSON.stringify(settings) })
if (!res.ok) throw new Error(`The email templates were not accepted (${res.status}): ${(await res.text()).slice(0, 400)}`)
console.log(`Project ${requireEnv('SUPABASE_PROJECT_REF')}: ${Object.keys(EMAILS).join(', ')} now use the hub's own emails.`)
