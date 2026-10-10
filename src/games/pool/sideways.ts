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

/**
 * Where a touch falls inside an element, as fractions of the element's own width and height
 * (0 to 1 each). `box` is the element as it sits on the glass (getBoundingClientRect).
 *
 * The turn is a quarter turn clockwise: the element's own left-to-right runs down the glass,
 * and its top-to-bottom runs from the right of the glass to the left.
 */
export function pointIn(box: DOMRect | { left: number; top: number; right: number; width: number; height: number }, clientX: number, clientY: number, sideways: boolean): [number, number] {
  return sideways ? [(clientY - box.top) / box.height, (box.right - clientX) / box.width] : [(clientX - box.left) / box.width, (clientY - box.top) / box.height]
}

/** How far a finger has travelled down an element, in pixels, from where it first touched. */
export function travelDown(start: { x: number; y: number }, clientX: number, clientY: number, sideways: boolean): number {
  return sideways ? start.x - clientX : clientY - start.y
}
