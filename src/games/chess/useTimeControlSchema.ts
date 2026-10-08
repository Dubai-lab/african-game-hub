import { useMemo } from 'react'
import { useGameTypes } from '@/core/games/useGameTypes'
import { parseTimeControls } from './timeControls'

// Used when the games registry cannot be reached: practice games must work offline.
const OFFLINE_SCHEMA = {
  time_controls: [
    { id: '1+0', base_ms: 60_000, increment_ms: 0 },
    { id: '3+2', base_ms: 180_000, increment_ms: 2000 },
    { id: '5+0', base_ms: 300_000, increment_ms: 0 },
    { id: '10+0', base_ms: 600_000, increment_ms: 0 },
  ],
}

/** The time controls on offer for chess: the registry's when it is reachable, a built-in set otherwise. */
export function useTimeControlSchema(): unknown {
  const games = useGameTypes()
  return useMemo(() => {
    const fromRegistry = games.data?.find((g) => g.id === 'chess')?.optionsSchema
    return parseTimeControls(fromRegistry).length > 0 ? fromRegistry : OFFLINE_SCHEMA
  }, [games.data])
}
