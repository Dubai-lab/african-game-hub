// Pool is played on a table lying flat. A phone held upright is too narrow for that, and most
// players never turn their phone (many keep rotation switched off), so on an upright phone the
// game draws its whole screen turned a quarter turn: the player turns the phone and the table
// fills it. With rotation switched on the phone turns the page itself and nothing is turned here.
//
// What is drawn turned must also be touched turned: a finger's place on the glass is worked out
// here for anything inside the turned screen.
import { createContext } from 'react'

/** True for everything inside a screen that the game itself has turned. */
export const Sideways = createContext(false)

/** Marks the element that is the turned screen (see PoolTable). */
export const TURNED_SCREEN = 'data-turned-screen'

type Box = { left: number; top: number; right: number; width: number; height: number }

/**
 * Where a touch falls inside an element, as fractions of the element's own width and height
 * (0 to 1 each), from the element as it sits on the glass (`box`, its getBoundingClientRect).
 *
 * The turn is a quarter turn clockwise: the element's own left-to-right runs down the glass,
 * and its top-to-bottom runs from the right of the glass to the left.
 */
export function pointIn(box: Box, clientX: number, clientY: number, sideways: boolean): [number, number] {
  return sideways ? [(clientY - box.top) / box.height, (box.right - clientX) / box.width] : [(clientX - box.left) / box.width, (clientY - box.top) / box.height]
}

/**
 * The same, for a real element on the page, and the one to use.
 *
 * On a turned screen it does not ask the browser where the turned element is on the glass:
 * some phones answer that wrongly for a turned, fixed screen (the answer is off by the height
 * of the status bar, which put the far pockets of the table out of reach). The place is worked
 * out from where the turned screen hangs and where the element sits inside it, which no browser
 * gets wrong: the screen hangs from its top left corner, and that corner's own left-to-right
 * runs down the glass.
 */
export function touchIn(element: HTMLElement, clientX: number, clientY: number, sideways: boolean): [number, number] {
  const screen = sideways ? element.closest<HTMLElement>(`[${TURNED_SCREEN}]`) : null
  if (!screen) return pointIn(element.getBoundingClientRect(), clientX, clientY, false)
  // In the turned screen's own pixels.
  let x = clientY - screen.offsetTop
  let y = screen.offsetLeft - clientX
  // Then in the element's: step out through whatever it is placed in, as far as the screen.
  for (let node: HTMLElement | null = element; node && node !== screen; node = node.offsetParent as HTMLElement | null) {
    x -= node.offsetLeft
    y -= node.offsetTop
    const frame = node.offsetParent as HTMLElement | null
    if (frame && frame !== screen) {
      x -= frame.clientLeft
      y -= frame.clientTop
    }
  }
  return [x / element.offsetWidth, y / element.offsetHeight]
}

/** How far a finger has travelled down an element, in pixels, from where it first touched. */
export function travelDown(start: { x: number; y: number }, clientX: number, clientY: number, sideways: boolean): number {
  return sideways ? start.x - clientX : clientY - start.y
}

/**
 * Pulling the cue that lies on the table. `from` is where the finger went down, `to` where it
 * is now, `aim` the direction of the shot (all in the table's own measure). Pulling straight
 * back along the cue, away from the ball, draws it; `full` is the pull that gives full power.
 * Returns 0 to 1.
 */
export function pullAlongCue(from: { x: number; y: number }, to: { x: number; y: number }, aim: { dx: number; dy: number }, full: number): number {
  const length = Math.hypot(aim.dx, aim.dy) || 1
  const back = -((to.x - from.x) * aim.dx + (to.y - from.y) * aim.dy) / length
  return Math.min(1, Math.max(0, back / full))
}

/**
 * Is this point on the cue? The cue lies behind the cue ball, along the line of aim, from
 * `near` to `far` away from the ball's centre; a finger within `reach` of it has hold of it.
 */
export function onCue(point: { x: number; y: number }, ball: { x: number; y: number }, aim: { dx: number; dy: number }, near: number, far: number, reach: number): boolean {
  const length = Math.hypot(aim.dx, aim.dy) || 1
  const ux = -aim.dx / length
  const uy = -aim.dy / length
  const along = (point.x - ball.x) * ux + (point.y - ball.y) * uy
  const across = Math.abs((point.x - ball.x) * -uy + (point.y - ball.y) * ux)
  return along >= near && along <= far && across <= reach
}
