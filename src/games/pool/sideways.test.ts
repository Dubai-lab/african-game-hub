import { describe, expect, it } from 'vitest'
import { onCue, pointIn, pullAlongCue, travelDown } from './sideways'

// An element 200 wide and 100 high in its own terms.
describe('touches on a pool screen the game has turned', () => {
  it('reads a touch straight when nothing is turned', () => {
    const box = { left: 10, top: 20, right: 210, width: 200, height: 100 }
    expect(pointIn(box, 10, 20, false)).toEqual([0, 0])
    expect(pointIn(box, 110, 70, false)).toEqual([0.5, 0.5])
    expect(pointIn(box, 210, 120, false)).toEqual([1, 1])
  })

  it('reads a touch through the quarter turn', () => {
    // Turned clockwise, the same element stands 100 wide and 200 high on the glass.
    const box = { left: 50, top: 0, right: 150, width: 100, height: 200 }
    // Its own top left corner is at the top right of where it stands.
    expect(pointIn(box, 150, 0, true)).toEqual([0, 0])
    // Its own top right corner is at the bottom right.
    expect(pointIn(box, 150, 200, true)).toEqual([1, 0])
    // Its own bottom left corner is at the top left.
    expect(pointIn(box, 50, 0, true)).toEqual([0, 1])
    expect(pointIn(box, 100, 100, true)).toEqual([0.5, 0.5])
  })

  it('knows a finger on the cue lying on the table from one elsewhere', () => {
    // Aiming right: the cue lies to the left of the ball.
    const ball = { x: 1000, y: 600 }
    const aim = { dx: 1, dy: 0 }
    expect(onCue({ x: 700, y: 610 }, ball, aim, 40, 1200, 100)).toBe(true)
    // In front of the ball, on the ball itself, beside the cue, beyond its end: not on it.
    expect(onCue({ x: 1300, y: 600 }, ball, aim, 40, 1200, 100)).toBe(false)
    expect(onCue({ x: 990, y: 600 }, ball, aim, 40, 1200, 100)).toBe(false)
    expect(onCue({ x: 700, y: 800 }, ball, aim, 40, 1200, 100)).toBe(false)
    expect(onCue({ x: -400, y: 600 }, ball, aim, 40, 1200, 100)).toBe(false)
    // Aiming down the table: the cue lies above the ball.
    expect(onCue({ x: 1010, y: 300 }, ball, { dx: 0, dy: 5 }, 40, 1200, 100)).toBe(true)
  })

  it('turns a pull back along the cue into power', () => {
    const aim = { dx: 1, dy: 0 }
    expect(pullAlongCue({ x: 700, y: 600 }, { x: 350, y: 600 }, aim, 700)).toBe(0.5)
    expect(pullAlongCue({ x: 700, y: 600 }, { x: -900, y: 600 }, aim, 700)).toBe(1)
    // Pushing forward, or sliding across the cue, draws nothing.
    expect(pullAlongCue({ x: 700, y: 600 }, { x: 900, y: 600 }, aim, 700)).toBe(0)
    expect(pullAlongCue({ x: 700, y: 600 }, { x: 700, y: 100 }, aim, 700)).toBe(0)
  })

  it('measures a pull down the cue either way', () => {
    expect(travelDown({ x: 100, y: 100 }, 100, 160, false)).toBe(60)
    // Turned, "down" the cue is towards the left of the glass.
    expect(travelDown({ x: 100, y: 100 }, 40, 100, true)).toBe(60)
    expect(travelDown({ x: 100, y: 100 }, 100, 160, true)).toBe(0)
  })
})
