// One Africa Life: what the walker meets inside the town's buildings, kept here for all of them
// (the businesses' insides, Furniture City's floors): their walls and fittings (walked against),
// their places (where something is done: a counter, a thing on display), their rooms (the
// camera kept under their ceilings).
import type { Solid } from './cityGen'

/** A place where something is done, at a point, facing a way. */
export type CityPlace = { name: string; x: number; y: number; face: number[]; out?: number; exit?: [number, number] }

/** An inside set in its building: where it stands, how it is turned and sized. */
export type Room = { key: string; kind: string; name: string; cat: string; mx: number; my: number; nx: number; ny: number; u0: number; u1: number; d: number; h: number; s: number; f0: number }

export const insideSolids = new Map<string, Solid[]>()
export const insidePlaces = new Map<string, CityPlace[]>()
export const insideRooms = new Map<string, Room>()
