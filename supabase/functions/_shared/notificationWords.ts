// What a notification says when it is sent on to a phone, where the app is not there to say it
// in its own words: a short title, a line under it, and where a tap leads. (Inside the app the
// same notifications are worded by the app itself, from its own translations.)

export type NotificationKind = 'friend_request' | 'friend_accepted' | 'challenge' | 'tournament_started' | 'support_answered' | 'announcement'
export type PushMessage = { title: string; body: string; url: string; tag: string }

const GAMES: Record<string, string> = { chess: 'Chess', ludo: 'Ludo', draughts: 'Draughts', pool: 'Pool', checkup: 'Check Up', words: 'Word Battle', oware: 'Oware', basketball: 'Street Basketball' }
const GAMES_FR: Record<string, string> = { chess: 'Échecs', ludo: 'Ludo', draughts: 'Dames', pool: 'Billard', checkup: 'Check Up', words: 'Word Battle', oware: 'Awalé', basketball: 'Basket de rue' }
const short = (value: unknown, max: number) => {
  const words = String(value ?? '').trim()
  return words.length > max ? `${words.slice(0, max - 1)}…` : words
}

/** The words for one notification, in English or French (English for any other language). Null for a kind nobody has written. */
export function pushWords(kind: string, data: Record<string, unknown>, language: string): PushMessage | null {
  const fr = language === 'fr'
  const who = short(data.username, 30)
  const game = (fr ? GAMES_FR : GAMES)[String(data.game)] ?? ''
  switch (kind) {
    case 'friend_request':
      return { title: fr ? 'Demande d’ami' : 'Friend request', body: fr ? `${who} veut être votre ami.` : `${who} wants to be your friend.`, url: '/friends', tag: 'friend' }
    case 'friend_accepted':
      return { title: fr ? 'Nouvel ami' : 'New friend', body: fr ? `${who} a accepté votre demande.` : `${who} accepted your request.`, url: '/friends', tag: 'friend' }
    case 'challenge':
      return {
        title: fr ? 'On vous défie' : 'You have been challenged',
        body: fr ? `${who} vous défie${game ? ` : ${game}` : ''}.` : `${who} challenges you${game ? ` to ${game}` : ''}.`,
        url: typeof data.challenge_id === 'string' ? `/challenge/${data.challenge_id}` : '/lobby',
        tag: 'challenge',
      }
    case 'tournament_started':
      return {
        title: fr ? 'Votre tournoi commence' : 'Your tournament is starting',
        body: short(data.name, 60),
        url: typeof data.tournament_id === 'string' ? `/tournaments/${data.tournament_id}` : '/lobby',
        tag: 'tournament',
      }
    case 'support_answered':
      return { title: fr ? 'Réponse de notre équipe' : 'An answer from our team', body: fr ? 'Nous avons répondu à votre message. Regardez vos e-mails.' : 'We have answered your report. Check your email.', url: '/support', tag: 'support' }
    case 'announcement':
      return { title: short(data.title, 60), body: short(data.body, 140), url: '/lobby', tag: 'announcement' }
    default:
      return null
  }
}
