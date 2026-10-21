// One Africa Life: how the town's vehicles drive (./CityTraffic.tsx). Each is driven as a car is:
// its driver looks a little ahead along the lane it means to keep (on the right of the road; in a
// junction, the lane of the road it turns into) and steers for that point, no more than its
// wheels turn; the car goes where its front wheels point (a bicycle's model: it turns on a curve,
// never on the spot). It slows for a bend as sharp as the turn ahead, stops at the line before a
// light that is not green, keeps its distance behind what is ahead of it (a vehicle, a person),
// and never goes where another vehicle is. Behind a slow one, on a road with a lane each way, it
// pulls out to pass when the other lane is clear, and back in.
import { type City, junctionRadius, signalGroups, signalled, signalState } from './cityGen'

/** On an edge, going from one of its nodes to the other. */
export type Leg = { edge: number; from: number; to: number }

/** A vehicle's box on the map: centre, heading, half length and width. */
export type Box = { x: number; y: number; yaw: number; hl: number; hw: number }

export type Drive = {
  /** The way it goes: its legs (the one it is on first), so far along the one it is on. */
  legs: Leg[]
  leg: number
  s: number
  x: number
  y: number
  yaw: number
  /** Speed (m/s), the front wheels' angle (radians, + left), its turning (radians a second). */
  v: number
  steer: number
  yawRate: number
  /** How far the wheels have turned (radians), for drawing them. */
  spin: number
  /** Its lane: how far right of the road's middle it keeps (and means to). */
  offset: number
  wantOffset: number
  /** Its size and wheels: length, width, wheelbase, wheels' radius; its speed in town. */
  len: number
  wide: number
  L: number
  r: number
  top: number
  braking: boolean
  /** Seconds behind a slow one (to pass it), seconds held up (to give up and go round). */
  slow: number
  held: number
  /** Seconds out passing. */
  passing: number
  /** Seconds stopped for a vehicle in its way (not for a light): the longest waiting goes first. */
  wait?: number
  /** Its place in the town's give-way (two that have waited as long: the higher goes first). */
  rank?: number
  /** Seconds backing off (to let the one going first by). */
  back?: number
}

/** Which of two stopped in each other's way goes first: the longer waiting, else the higher rank. */
const goesFirst = (a: Drive, b: Drive | undefined) => {
  const wa = a.wait ?? 0
  const wb = b?.wait ?? 0
  if (Math.abs(wa - wb) > 0.5) return wa > wb
  return (a.rank ?? 0) > (b?.rank ?? 0)
}

const MAX_STEER = 0.62
const STEER_RATE = 1.6
const BRAKE = 5.5
const ACCEL = 2.2
const LAT = 2.6

const lane = (city: City, e: number) => city.edges[e]!.w / 4

// Each signalled junction's two ways, worked out once.
const groupCache = new WeakMap<City, Map<number, Record<number, 'A' | 'B'>>>()
function groupsAt(city: City, n: number) {
  let m = groupCache.get(city)
  if (!m) groupCache.set(city, (m = new Map()))
  let g = m.get(n)
  if (!g) m.set(n, (g = signalGroups(city, n)))
  return g
}

/** A point on a leg, so far along its middle, so far right of it. */
export function legPoint(city: City, leg: Leg, s: number, right: number) {
  const a = city.nodes[leg.from]!
  const b = city.nodes[leg.to]!
  const len = city.edges[leg.edge]!.len
  const t = Math.max(0, Math.min(1, s / len))
  const ux = (b.x - a.x) / len
  const uy = (b.y - a.y) / len
  return { x: a.x + (b.x - a.x) * t + uy * right, y: a.y + (b.y - a.y) * t - ux * right, ux, uy }
}

/** The point so far ahead along the way (its lane), from where the vehicle is on it. */
function ahead(city: City, d: Drive, dist: number) {
  let leg = d.leg
  let s = d.s + dist
  while (leg < d.legs.length - 1 && s > city.edges[d.legs[leg]!.edge]!.len) {
    s -= city.edges[d.legs[leg]!.edge]!.len
    leg++
  }
  const l = d.legs[leg]!
  // Its own lane on its own road; out passing, the other.
  const right = leg === d.leg ? d.offset : lane(city, l.edge)
  return legPoint(city, l, Math.min(s, city.edges[l.edge]!.len), right)
}

/** The turn at the end of this leg (radians, + left) and how far off it is. */
function turnAhead(city: City, d: Drive) {
  const here = d.legs[d.leg]!
  const next = d.legs[d.leg + 1]
  const toEnd = city.edges[here.edge]!.len - d.s
  if (!next) return { angle: 0, dist: toEnd }
  const a = city.nodes[here.from]!
  const b = city.nodes[here.to]!
  const c = city.nodes[next.to]!
  const t1 = Math.atan2(b.y - a.y, b.x - a.x)
  const t2 = Math.atan2(c.y - b.y, c.x - b.x)
  return { angle: Math.atan2(Math.sin(t2 - t1), Math.cos(t2 - t1)), dist: toEnd }
}

/** Two boxes overlap (with a margin): by their axes, either box's. */
export function overlaps(a: Box, b: Box, margin = 0.15) {
  const axes = [a.yaw, a.yaw + Math.PI / 2, b.yaw, b.yaw + Math.PI / 2]
  const corners = (q: Box) => {
    const c = Math.cos(q.yaw)
    const s = Math.sin(q.yaw)
    return [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ].map(([i, j]) => [q.x + c * (q.hl + margin) * i! - s * (q.hw + margin) * j!, q.y + s * (q.hl + margin) * i! + c * (q.hw + margin) * j!])
  }
  const ca = corners(a)
  const cb = corners(b)
  for (const ang of axes) {
    const ax = Math.cos(ang)
    const ay = Math.sin(ang)
    const pa = ca.map(([x, y]) => x! * ax + y! * ay)
    const pb = cb.map(([x, y]) => x! * ax + y! * ay)
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false
  }
  return true
}

export const boxOf = (d: Drive): Box => ({ x: d.x, y: d.y, yaw: d.yaw, hl: d.len / 2, hw: d.wide / 2 })

/** What is round a vehicle as it drives: the others (their boxes, their speeds), the player on foot. */
export type Around = { others: { box: Box; v: number; d?: Drive }[]; player?: { x: number; y: number }; seconds: number; stopAt?: number; eager?: boolean }

/**
 * One step of driving: steered for the lane ahead, sped up or slowed (for the turn, the light,
 * what is ahead, where it means to stop), moved, never into another vehicle. Returns false if it
 * came to the end of its way.
 */
export function drive(city: City, d: Drive, dt: number, around: Around): boolean {
  const here = d.legs[d.leg]!
  const e = city.edges[here.edge]!
  // The lane: back in on its own side once past (or never out on a one-way road).
  d.offset += Math.max(-1.2 * dt, Math.min(1.2 * dt, d.wantOffset - d.offset))
  // Steering: for the point ahead (nearer when slow, as one looks nearer in a turn).
  const look = 3.2 + d.v * 0.55
  const target = ahead(city, d, look)
  const fx = Math.cos(d.yaw)
  const fy = Math.sin(d.yaw)
  const tx = target.x - d.x
  const ty = target.y - d.y
  const ld = Math.hypot(tx, ty) || 1
  const alpha = Math.atan2(fx * ty - fy * tx, fx * tx + fy * ty)
  const wantSteer = Math.max(-MAX_STEER, Math.min(MAX_STEER, Math.atan2(2 * d.L * Math.sin(alpha), ld)))
  d.steer += Math.max(-STEER_RATE * dt, Math.min(STEER_RATE * dt, wantSteer - d.steer))
  // Speed: the road's, the turn's, the light's, what is ahead's, the stop's.
  let want = e.kind === 'minor' || e.kind === 'path' ? Math.min(d.top, 6) : d.top
  const turn = turnAhead(city, d)
  const jr = junctionRadius(city, here.to)
  if (Math.abs(turn.angle) > 0.35) {
    const vTurn = Math.sqrt(LAT / Math.max(0.05, Math.abs(turn.angle) / 9))
    want = Math.min(want, Math.sqrt(vTurn * vTurn + 2 * BRAKE * 0.6 * Math.max(0, turn.dist - jr)))
  }
  // The light at the junction ahead: not green, stopped before its line (amber, if it can).
  const lit = signalled(city, here.to)
  if (lit) {
    const group = groupsAt(city, here.to)[here.edge]
    const light = group ? signalState(around.seconds)[group] : 'g'
    const line = turn.dist - jr - 4
    if (light !== 'g' && line > -0.5 && (light === 'r' || line > (d.v * d.v) / (2 * BRAKE))) want = Math.min(want, Math.sqrt(2 * BRAKE * 0.8 * Math.max(0, line - 0.5)))
  }
  // What is ahead in its way: the nearest vehicle (or person) in front, within its width.
  let gap = Infinity
  let slowAhead = false
  let stuckAhead = false
  let nearest: Around['others'][number] | null = null
  const waited = d.wait ?? 0
  let yielded = false
  let giveWay = false
  for (const o of around.others) {
    const dx = o.box.x - d.x
    const dy = o.box.y - d.y
    const along = dx * fx + dy * fy
    if (along <= 0 || along > 40) continue
    const side = Math.abs(-dx * fy + dy * fx)
    // In its way: within its width, or crossing just ahead (in a junction).
    const crossing = Math.abs(Math.sin(o.box.yaw - d.yaw)) > 0.5
    if (side > d.wide / 2 + o.box.hw + (crossing ? 2.2 : 0.5)) continue
    // Two waiting on each other across a junction: the one that has waited longer goes first
    // (the other's box still never met: it goes only where nothing is).
    // Two stopped in each other's way (across a junction, or nose to nose turning): one goes
    // first, round the other (its box never met: it goes only where nothing is); the other, if
    // the first is stuck against it, backs off a little.
    const facing = Math.cos(o.box.yaw - d.yaw) < 0.9
    // The one just ahead backing off (to let another by): back a little with it.
    if (!facing && (o.d?.back ?? 0) > 0 && along < d.len / 2 + o.box.hl + 3) giveWay = true
    // (Waited long, not in a queue in its own lane: it edges on wherever there is room.)
    const inLine = !facing && side < 1
    if (o.v < 0.5 && waited > 12 && !inLine && !(lit && turn.dist - jr < 12)) {
      yielded = true
      continue
    }
    if (facing && o.v < 0.5 && waited > 2) {
      if (goesFirst(d, o.d)) {
        yielded = true
        continue
      }
      if (o.d && o.d.held > 1 && along < 9) giveWay = true
    }
    const g = along - d.len / 2 - (crossing ? o.box.hw : o.box.hl)
    if (g < gap) {
      gap = g
      slowAhead = o.v < d.top * 0.55
      stuckAhead = !crossing && o.v < 0.5 && (o.d?.wait ?? 0) > 3
      nearest = o
    }
  }
  if (around.player) {
    const dx = around.player.x - d.x
    const dy = around.player.y - d.y
    const along = dx * fx + dy * fy
    if (along > 0 && Math.abs(-dx * fy + dy * fx) < d.wide / 2 + 0.8) gap = Math.min(gap, along - d.len / 2 - 0.3)
  }
  if (gap < Infinity) want = Math.min(want, Math.sqrt(2 * BRAKE * 0.7 * Math.max(0, gap - 2.5)))
  // (Going first through the other's way, it keeps its turn till it is through.)
  d.wait = yielded || (gap < 8 && d.v < 0.5) ? waited + dt : 0
  if (around.stopAt !== undefined) want = Math.min(want, Math.sqrt(2 * BRAKE * 0.7 * Math.max(0, around.stopAt)))
  // Passing: held behind a slow one (or one stuck, not at a light) a while, on a road both ways
  // with nobody coming, no junction near. A driver in a hurry (the player said faster) goes sooner.
  const eager = around.eager ?? false
  // (Never down a queue: a stopped one with another stopped in front of it is in one.)
  const queue = nearest !== null && nearest.v < 1 && around.others.some((q) => {
    if (q === nearest || q.v > 1 || Math.cos(q.box.yaw - d.yaw) < 0.8) return false
    const dx = q.box.x - nearest!.box.x
    const dy = q.box.y - nearest!.box.y
    const al = dx * fx + dy * fy
    return al > 0 && al < 14 && Math.abs(-dx * fy + dy * fx) < 1.6
  })
  d.slow = (slowAhead || stuckAhead) && !queue && gap < 16 ? d.slow + dt : 0
  const atLight = lit && turn.dist < 80
  const room = turn.dist > (eager ? 28 : 45) || (stuckAhead && turn.dist > 15)
  if (d.wantOffset > 0 && d.slow > (eager ? 0.8 : 2.5) && !atLight && !e.one && e.w >= 5.5 && room && clearToPass(d, around, eager ? 50 : 70)) d.wantOffset = -lane(city, here.edge)
  // Back in: its own lane clear beside it and a car's length ahead (past what it passed), or out
  // a long while, or something coming the other way.
  d.passing = d.wantOffset < 0 ? d.passing + dt : 0
  if (d.wantOffset < 0 && (e.one || d.passing > 1.5 || comingAt(d, around)) && sideClear(d, around, lane(city, here.edge))) d.wantOffset = lane(city, here.edge)
  else if (d.wantOffset < 0 && d.passing > 14 && comingAt(d, around)) want = Math.min(want, 2)
  d.braking = want < d.v - 0.3
  d.v += Math.max(-BRAKE * dt, Math.min(ACCEL * dt, want - d.v))
  d.v = Math.max(0, d.v)
  // Moved: where its front wheels point (its turning from its speed, its wheelbase, its steering).
  const yawRate = (d.v / d.L) * Math.tan(d.steer)
  const yaw = d.yaw + yawRate * dt
  const x = d.x + Math.cos(yaw) * d.v * dt
  const y = d.y + Math.sin(yaw) * d.v * dt
  const next: Box = { x, y, yaw, hl: d.len / 2, hw: d.wide / 2 }
  // Backing off (giving way to one going first, stuck against it): slowly back, a few metres.
  if (giveWay && !(d.back ?? 0)) d.back = 0.01
  if ((d.back ?? 0) > 0) {
    d.back! += dt
    if (d.back! > 2.2) {
      // Backed off: the other goes first (it has waited longer now).
      d.back = 0
      d.wait = 0
      d.held = 0
    }
    const bx = d.x - fx * 1.2 * dt
    const by = d.y - fy * 1.2 * dt
    const nb: Box = { x: bx, y: by, yaw: d.yaw, hl: d.len / 2, hw: d.wide / 2 }
    d.v = 0
    d.steer *= 0.9
    if ((d.s > -6 || d.leg > 0) && !around.others.some((o) => overlaps(nb, o.box, 0.1))) {
      d.x = bx
      d.y = by
      d.s -= 1.2 * dt
      d.spin -= (1.2 * dt) / d.r
      // Back into the road it came from.
      if (d.s < 0 && d.leg > 0) {
        d.leg--
        d.s += city.edges[d.legs[d.leg]!.edge]!.len
        d.offset = d.wantOffset = lane(city, d.legs[d.leg]!.edge)
      }
    }
    d.yawRate = 0
    return true
  }
  // Never into another vehicle: if it would be, it stays where it is (unless already touching it
  // and moving away from it: two pressed together must still be able to part).
  const here0: Box = { x: d.x, y: d.y, yaw: d.yaw, hl: d.len / 2, hw: d.wide / 2 }
  const blockers = around.others.filter((o) => overlaps(next, o.box, 0.1) && (!overlaps(here0, o.box, 0.1) || (o.box.x - d.x) * (x - d.x) + (o.box.y - d.y) * (y - d.y) > 0))
  if (blockers.length) {
    // Held against one held against it: the one that does not go first backs off.
    d.wait = Math.max(d.wait ?? 0, d.held)
    if (d.held > 1.2 && blockers.some((o) => o.v < 0.5 && !goesFirst(d, o.d))) d.back = 0.01
    // Going first but met the other: round it, keeping right (onto the kerb's edge if it must).
    // (Round the side away from what it met.)
    if (yielded) {
      const b = blockers[0]!.box
      const left = -(b.x - d.x) * Math.sin(d.yaw) + (b.y - d.y) * Math.cos(d.yaw)
      const l = lane(city, here.edge)
      d.wantOffset = left > 0 ? Math.max(d.wantOffset, l + 1.7) : Math.min(d.wantOffset, l - 1.7)
    }
    d.v = 0
    d.held += dt
    d.yawRate = 0
    return true
  }
  d.held = 0
  // Round it and on: back to its lane.
  const own = lane(city, here.edge)
  if (!yielded && d.wait === 0 && d.passing === 0 && Math.abs(d.wantOffset - own) > 0.1 && sideClear(d, around, own)) d.wantOffset = own
  d.yawRate = yawRate
  d.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw))
  d.x = x
  d.y = y
  d.spin += (d.v * dt) / d.r
  // Along its way: so far on this leg (as it goes); on to the next at the end of this one.
  d.s += d.v * dt
  while (d.s > city.edges[d.legs[d.leg]!.edge]!.len) {
    if (d.leg >= d.legs.length - 1) return false
    d.s -= city.edges[d.legs[d.leg]!.edge]!.len
    d.leg++
    d.offset = d.wantOffset = lane(city, d.legs[d.leg]!.edge)
  }
  return true
}

/** The other lane clear far enough ahead to pass (nobody coming, nobody in it). */
function clearToPass(d: Drive, around: Around, reach = 70) {
  const fx = Math.cos(d.yaw)
  const fy = Math.sin(d.yaw)
  for (const o of around.others) {
    const dx = o.box.x - d.x
    const dy = o.box.y - d.y
    const along = dx * fx + dy * fy
    const left = -(-dx * fy + dy * fx)
    if (along > -8 && along < reach && left > 0.8 && left < 5.5) return false
  }
  return true
}

/** Something coming the other way, ahead in the lane it is out in. */
function comingAt(d: Drive, around: Around) {
  const fx = Math.cos(d.yaw)
  const fy = Math.sin(d.yaw)
  return around.others.some((o) => {
    const dx = o.box.x - d.x
    const dy = o.box.y - d.y
    const along = dx * fx + dy * fy
    return along > 0 && along < 60 && Math.abs(-dx * fy + dy * fx) < 2.5 && Math.cos(o.box.yaw - d.yaw) < -0.5
  })
}

/** Its own lane clear beside it and a little ahead (to pull back in, in front of what it passed). */
function sideClear(d: Drive, around: Around, laneW: number) {
  const fx = Math.cos(d.yaw)
  const fy = Math.sin(d.yaw)
  for (const o of around.others) {
    const dx = o.box.x - d.x
    const dy = o.box.y - d.y
    const along = dx * fx + dy * fy
    const right = -dx * fy + dy * fx
    if (along > -(d.len + 1.5) && along < d.len + 6 && right < 0 && right > -laneW * 2 - 1) return false
  }
  return true
}

/** A vehicle set on its way: at a point of its first leg, facing along it, in its lane. */
export function startDrive(city: City, legs: Leg[], s: number, size: { len: number; wide: number; L: number; r: number; top: number }, v = 0): Drive {
  const p = legPoint(city, legs[0]!, s, lane(city, legs[0]!.edge))
  return { legs, leg: 0, s, x: p.x, y: p.y, yaw: Math.atan2(p.uy, p.ux), v, steer: 0, yawRate: 0, spin: 0, offset: lane(city, legs[0]!.edge), wantOffset: lane(city, legs[0]!.edge), ...size, braking: false, slow: 0, held: 0, passing: 0, rank: Math.random() }
}
