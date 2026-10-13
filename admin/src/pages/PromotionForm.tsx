import { useState } from 'react'
import { ApiError, api } from '../lib/api'
import type { Promotion } from '../lib/types'
import { Button, inputClass } from '../ui'

// The games on the hub. (The server refuses a name it does not know.)
export const GAMES: Record<string, string> = { chess: 'Chess', ludo: 'Ludo', draughts: 'Draughts', pool: 'Pool', checkup: 'Check Up', words: 'Word Battle' }

/** For a date-and-time box, which speaks the admin's own time zone and no other. */
const toBox = (iso: string) => {
  const at = new Date(iso)
  return new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

/** Sets a promotion up, or changes one: the period, what must be done, how many win, and the rules that keep it fair. */
export function PromotionForm({ promotion, done }: { promotion?: Promotion; done: (id: number) => Promise<void> | void }) {
  const [name, setName] = useState(promotion?.name ?? '')
  const [reward, setReward] = useState(promotion?.reward ?? '')
  const [startsAt, setStartsAt] = useState(toBox(promotion?.starts_at ?? new Date().toISOString()))
  const [endsAt, setEndsAt] = useState(toBox(promotion?.ends_at ?? inDays(7)))
  const [gamesNeeded, setGamesNeeded] = useState(String(promotion?.games_needed ?? 5))
  const [winners, setWinners] = useState(String(promotion?.winners ?? 10))
  const [gameTypes, setGameTypes] = useState<string[]>(promotion?.game_types ?? [])
  const [newPlayersOnly, setNewPlayersOnly] = useState(promotion?.new_players_only ?? true)
  const [maxPerOpponent, setMaxPerOpponent] = useState(String(promotion?.max_per_opponent ?? 1))
  const [minSeconds, setMinSeconds] = useState(String(promotion?.min_seconds ?? 60))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const saved = await api<{ id: number }>('promotions.save', {
        ...(promotion ? { promotionId: promotion.id } : {}),
        name: name.trim(),
        ...(reward.trim() ? { reward: reward.trim() } : {}),
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        gamesNeeded: Number(gamesNeeded),
        winners: Number(winners),
        gameTypes,
        newPlayersOnly,
        maxPerOpponent: Number(maxPerOpponent),
        minSeconds: Number(minSeconds),
      })
      await done(saved.id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  const field = 'grid gap-1 font-semibold'
  return (
    <form onSubmit={submit} className="grid gap-4 px-4 py-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={field}>
          Name (for our team)
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={80} placeholder="Register and play 5 games" className={inputClass} />
        </label>
        <label className={field}>
          What the winners get (a note; nothing is paid by the system)
          <input value={reward} onChange={(e) => setReward(e.target.value)} maxLength={200} placeholder="1000 RWF by mobile money" className={inputClass} />
        </label>
        <label className={field}>
          Starts (your time)
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required className={inputClass} />
        </label>
        <label className={field}>
          Ends (your time)
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required className={inputClass} />
        </label>
        <label className={field}>
          Games a player must finish
          <input type="number" value={gamesNeeded} onChange={(e) => setGamesNeeded(e.target.value)} required min={1} max={1000} className={inputClass} />
        </label>
        <label className={field}>
          How many players win (the first to get there)
          <input type="number" value={winners} onChange={(e) => setWinners(e.target.value)} required min={1} max={10000} className={inputClass} />
        </label>
      </div>

      <fieldset>
        <legend className="font-semibold">Which games count</legend>
        <p className="text-muted">Tick none and every game counts. Games against the computer never count: they are not played on the server.</p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {Object.entries(GAMES).map(([id, label]) => (
            <label key={id} className="flex items-center gap-1.5">
              <input type="checkbox" checked={gameTypes.includes(id)} onChange={(e) => setGameTypes(e.target.checked ? [...gameTypes, id] : gameTypes.filter((g) => g !== id))} className="size-4" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 font-semibold">Rules that keep it fair</legend>
        <label className="flex items-start gap-2 sm:col-span-2">
          <input type="checkbox" checked={newPlayersOnly} onChange={(e) => setNewPlayersOnly(e.target.checked)} className="mt-0.5 size-4" />
          <span>
            <span className="font-semibold">Only players who register after it starts</span>
            <span className="block text-muted">Untick to let players who were already on the hub take part.</span>
          </span>
        </label>
        <label className={field}>
          Games that count against the same opponent
          <input type="number" value={maxPerOpponent} onChange={(e) => setMaxPerOpponent(e.target.value)} required min={1} max={1000} className={inputClass} />
          <span className="font-normal text-muted">1 means two accounts cannot play each other again and again to get there.</span>
        </label>
        <label className={field}>
          Shortest game that counts, in seconds
          <input type="number" value={minSeconds} onChange={(e) => setMinSeconds(e.target.value)} required min={0} max={3600} className={inputClass} />
          <span className="font-normal text-muted">A game given up at once is not a game played.</span>
        </label>
      </fieldset>

      {error && (
        <p role="alert" className="font-semibold text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Working…' : promotion ? 'Save changes' : 'Set up the promotion'}
        </Button>
      </div>
    </form>
  )
}
