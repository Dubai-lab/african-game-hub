import { describe, expect, it } from 'vitest'
import { chessModule } from './lobby'
import { paceOf, parseTimeControls, timeControlLabel } from './timeControls'

const schema = {
  time_controls: [
    { id: '1+0', base_ms: 60_000, increment_ms: 0 },
    { id: '3+2', base_ms: 180_000, increment_ms: 2000 },
    { id: '5+0', base_ms: 300_000, increment_ms: 0 },
    { id: '10+5', base_ms: 600_000, increment_ms: 5000 },
  ],
}

describe('chess time controls', () => {
  it('reads the registry schema and ignores anything malformed', () => {
    expect(parseTimeControls(schema)).toHaveLength(4)
    expect(parseTimeControls({})).toEqual([])
    expect(parseTimeControls({ time_controls: [{ id: 'x', base_ms: -5, increment_ms: 0 }] })).toEqual([])
    expect(parseTimeControls(null)).toEqual([])
  })

  it('labels and groups them the standard way', () => {
    const [bullet, blitz, five, rapid] = parseTimeControls(schema)
    expect([bullet, blitz, five, rapid].map((c) => timeControlLabel(c!))).toEqual(['1', '3 | 2', '5', '10 | 5'])
    expect([bullet, blitz, five, rapid].map((c) => paceOf(c!))).toEqual(['bullet', 'blitz', 'blitz', 'rapid'])
  })

  it('defaults to 5 minutes and rejects options that are no longer offered', () => {
    expect(chessModule.defaultOptions(schema)).toEqual({ time_control: '5+0' })
    expect(chessModule.defaultOptions({ time_controls: [schema.time_controls[0]] })).toEqual({ time_control: '1+0' })
    expect(chessModule.defaultOptions({})).toBeNull()
    expect(chessModule.isValidOptions(schema, { time_control: '3+2' })).toBe(true)
    expect(chessModule.isValidOptions(schema, { time_control: '15+10' })).toBe(false)
    expect(chessModule.isValidOptions(schema, null)).toBe(false)
  })
})
