/**
 * What the winner of a match receives, for display before a match starts. The server computes
 * the real payout at settlement with the same rule: the pot, less the rake rounded down.
 */
export function winnerPayout(stake: number, rakeBps: number, players = 2): { pot: number; rake: number; payout: number } {
  const pot = stake * players
  const rake = Math.floor((pot * rakeBps) / 10_000)
  return { pot, rake, payout: pot - rake }
}
