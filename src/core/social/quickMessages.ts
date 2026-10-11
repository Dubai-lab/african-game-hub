// What a player can send to an opponent with one touch during a match: ready-made messages
// and reactions. The server accepts only what is listed here (send_match_message, in
// supabase/migrations/20261011100000_quick_chat.sql): the two lists must match.
//
// A ready-made message is sent by its name, not its words, so each player reads it in their
// own language (chat.quick.<name> in the translations).

/** For every game. */
export const QUICK_COMMON = ['hello', 'good_luck', 'good_game', 'well_played', 'thanks', 'sorry', 'oops', 'gotta_go', 'rematch'] as const

/** What each game adds of its own. A game that is not listed offers the common ones only. */
export const QUICK_BY_GAME: Record<string, readonly string[]> = {
  chess: ['good_move', 'close_game'],
  draughts: ['good_move', 'nice_capture', 'close_game'],
  ludo: ['nice_roll', 'lucky', 'so_close'],
  pool: ['nice_shot', 'great_break', 'unlucky', 'so_close'],
  checkup: ['good_move', 'lucky', 'so_close'],
  words: ['good_move', 'close_game', 'so_close'],
}

/** Every name the server accepts. */
export const QUICK_MESSAGES: readonly string[] = [...new Set([...QUICK_COMMON, ...Object.values(QUICK_BY_GAME).flat()])]

/** The ready-made messages offered in a game: its own first (they are the ones about play), then the common ones. */
export function quickFor(gameId: string): string[] {
  const own = QUICK_BY_GAME[gameId] ?? []
  const [hello, goodLuck, ...rest] = QUICK_COMMON
  return [hello, goodLuck, ...own, ...rest]
}

export const EMOJI = [
  '👍', '👎', '👏', '🙌', '🤝', '🙏', '💪', '🔥',
  '🙂', '😀', '😂', '😉', '😎', '🤔', '😮', '😱',
  '😅', '😬', '😴', '😢', '😭', '😡', '🤯', '🥳',
  '❤️', '💔', '⭐', '🏆', '🎯', '🎲', '⏳', '👀',
] as const
