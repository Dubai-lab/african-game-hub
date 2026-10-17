import { describe, expect, it } from 'vitest'
import { screenToCourt } from './camera'

// The stick under a turned camera: up is always straight ahead of the camera, right its right.

describe('the stick under the camera', () => {
  it('facing the basket (down -z), up goes to the basket and right to +x', () => {
    const up = screenToCourt(0, -1, Math.PI)
    expect(up.x).toBeCloseTo(0)
    expect(up.z).toBeCloseTo(-1)
    const right = screenToCourt(1, 0, Math.PI)
    expect(right.x).toBeCloseTo(1)
    expect(right.z).toBeCloseTo(0)
  })

  it('turned a quarter (looking down +x), up goes to +x and right to +z', () => {
    const up = screenToCourt(0, -1, Math.PI / 2)
    expect(up.x).toBeCloseTo(1)
    expect(up.z).toBeCloseTo(0)
    const right = screenToCourt(1, 0, Math.PI / 2)
    expect(right.x).toBeCloseTo(0)
    expect(right.z).toBeCloseTo(1)
  })
})
