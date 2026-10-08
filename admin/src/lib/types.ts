// What the admin API answers with. These mirror the admin_* database functions.

export type Page<T> = { total: number; rows: T[] }

export type Overview = {
  players: number
  players_today: number
  banned: number
  active_matches: number
  matches_today: number
  searching: number
  tokens_bonus: number
  tokens_cash: number
  tokens_in_escrow: number
  rake_total: number
  rake_cash_total: number
  rake_today: number
  open_reports: number
  integrity_problems: number
  integrity_alerts: number
  last_alert_at: string | null
}

export type PlayerRow = {
  id: string
  username: string
  display_name: string | null
  country_code: string | null
  created_at: string
  email: string
  is_banned: boolean
  bonus_balance: number | null
  cash_balance: number | null
}

export type LedgerRow = {
  id: number
  amount: number
  balance_type: 'bonus' | 'cash'
  entry_type: string
  balance_after: number
  match_id: string | null
  created_at: string
}

export type AuditRow = {
  id: number
  action: string
  details: Record<string, unknown>
  created_at: string
  admin: string
  target?: string | null
  target_user_id?: string | null
  target_match_id?: string | null
}

export type Player = {
  id: string
  username: string
  display_name: string | null
  country_code: string | null
  created_at: string
  email: string
  email_confirmed: boolean
  last_sign_in_at: string | null
  is_admin: boolean
  is_banned: boolean
  ban_reason: string | null
  age_confirmed: boolean
  phone: string | null
  language: string
  match_chat_enabled: boolean
  bonus_balance: number
  cash_balance: number
  in_escrow: number
  ratings: { game: string; pool: string; rating: number; games: number; wins: number; losses: number; draws: number }[]
  ledger: LedgerRow[]
  matches: {
    id: string
    game_type: string
    rating_pool: string | null
    status: string
    result: string | null
    end_reason: string | null
    stake_amount: number
    created_at: string
    won: boolean | null
    tokens_change: number | null
    rating_before: number | null
    rating_after: number | null
    opponents: string | null
  }[]
  reports_against: number
  reports_open: number
  reports_made: number
  friends: number
  admin_actions: AuditRow[]
}

export type MatchRow = {
  id: string
  game_type: string
  rating_pool: string | null
  status: string
  result: string | null
  end_reason: string | null
  stake_amount: number
  settled: boolean
  created_at: string
  finished_at: string | null
  players: string | null
  winner: string | null
}

export type Match = Omit<MatchRow, 'players'> & {
  options: Record<string, unknown>
  started_at: string | null
  settled_at: string | null
  players: MatchPlayer[]
  rake: number | null
  game: Record<string, unknown> | null
  escrow: { username: string; amount: number; balance_type: string; status: string }[]
  ledger: { id: number; username: string; amount: number; balance_type: string; entry_type: string; created_at: string }[]
}
export type MatchPlayer = {
  user_id: string
  username: string
  seat: string
  rating_before: number | null
  rating_after: number | null
  tokens_change: number | null
}

export type Report = {
  id: number
  reason: string
  note: string | null
  status: 'open' | 'resolved' | 'dismissed'
  match_id: string | null
  created_at: string
  resolved_at: string | null
  resolution_note: string | null
  context: { from: string; kind: string; body: string; at: string }[]
  reporter_id: string
  reported_id: string
  reporter: string
  reported: string
  resolved_by: string | null
  reports_against_player: number
}

export type RevenueDay = { day: string; matches: number; staked: number; rake: number; rake_cash: number; signups: number }

export type Integrity = {
  problems: { check_name: string; user_id: string | null; detail: string }[]
  alerts: { id: number; checked_at: string; problems: unknown[] }[]
}
