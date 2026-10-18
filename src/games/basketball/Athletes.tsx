// The players as real characters: a model made in Blender from Mixamo downloads
// (scripts/makeBasketballCharacter.py), with its movements, chosen sixty times a second from
// what the simulation says each player is doing:
//
//   standing ............ idle             with the ball, standing ... dribble
//   running ............. run              with the ball, running .... run on the legs + dribble on the arms
//   guarding, sliding ... strafe left/right
//   rising to shoot ..... the body lifted by the jump, knees bent, in shooting form
//   up to block ......... one arm high, the other out
//   beaten by a crossover  stumble          game over ................ victory / defeated
//
// A shot, a block and a reach for the ball are made by turning the arm bones toward where the
// hands must go, on top of the movement playing: Mixamo has no jump shot, and this way any
// Mixamo character works without one. It decides nothing about the game.
import { useFrame, useLoader } from '@react-three/fiber'
import { type RefObject, useMemo, useRef } from 'react'
import { type AnimationAction, AnimationClip, AnimationMixer, type Bone, Color, LoopOnce, LoopRepeat, type Mesh, type Object3D, Quaternion, Vector3 } from 'three'
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { World } from './Court3D'
import { BALL_R } from '../../../supabase/functions/_shared/basketball'
import { dyeClothes } from './clothes'

// A new name for every new version: phones keep these files, and must not keep an old one.
export const CHARACTER_URL = '/basketball/player1.v7.glb'
/**
 * The dribble is motion capture: a loop of this many dribbles of the same length, the hand at
 * the top of its stroke at the start of each (scripts/makeBasketballCharacter.py). The ball is
 * timed by it: it leaves the palm, meets the floor half way, and is back in the palm.
 */
export const DRIBBLE_CYCLES = 4
/**
 * The crossover, also motion capture: two strokes of the dribble's length, the ball from the
 * right hand across to the left, then back to the right, where the dribble takes it up again.
 */
const CROSS_HANDS = ['right', 'left', 'right'] as const
/** How much faster than captured: the dribble standing and running, the crossover. */
const PACE = { dribble: 1.35, runDribble: 1.6, cross: 2.1 }

// Which bones belong to the legs and which to the arms, for playing two movements at once.
const LOWER = /(Hips|UpLeg|Leg|Foot|Toe)/
const UPPER = /(Spine|Neck|Head|Shoulder|Arm|Hand)/
// The natural speed of the movements as they were made (metres a second).
const RUN_SPEED = 5.1
const STRAFE_SPEED = 3.9

type Pose = 'idle' | 'dribble' | 'run' | 'runDribble' | 'cross' | 'runCross' | 'dunk' | 'strafe_left' | 'strafe_right' | 'stumble' | 'victory' | 'defeated'

const up = new Vector3(0, 1, 0)
const a = new Vector3()
const b = new Vector3()
const q = new Quaternion()
const q2 = new Quaternion()

/** Turns a bone (toward its child) to point along `direction`, by `weight` (0 to 1). */
function aim(bone: Object3D | undefined, child: Object3D | undefined, direction: Vector3, weight: number) {
  if (!bone || !child || !bone.parent || weight <= 0) return
  bone.getWorldPosition(a)
  child.getWorldPosition(b)
  const current = b.sub(a).normalize()
  q.setFromUnitVectors(current, direction)
  bone.getWorldQuaternion(q2)
  const target = q.multiply(q2)
  bone.parent.getWorldQuaternion(q2)
  const local = q2.invert().multiply(target)
  bone.quaternion.slerp(local, Math.min(1, weight))
  bone.updateMatrixWorld(true)
}

/** Each side's clothes: the hub's indigo and hibiscus. */
const KIT = ['#3d4fd6', '#d1264f']

const handTip = new Vector3()
const palmA = new Vector3()
const palmB = new Vector3()

function Athlete({ gltf, world, id }: { gltf: GLTF; world: RefObject<World>; id: number }) {
  const model = useMemo(() => {
    const copy = cloneSkinned(gltf.scene)
    const team = world.current!.game.players.find((p) => p.id === id)?.team ?? 0
    const kit = new Color(KIT[team]!)
    copy.traverse((o) => {
      const mesh = o as Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.frustumCulled = false
        // This player's own copy of the materials, the clothes in his side's colour.
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone()
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) dyeClothes(m, kit)
      }
    })
    return copy
  }, [gltf, world, id])
  const bones = useMemo(() => {
    const find = (suffix: string) => {
      let found: Bone | undefined
      model.traverse((o) => {
        if (!found && (o as Bone).isBone && o.name.endsWith(suffix)) found = o as Bone
      })
      return found
    }
    return {
      rightArm: find('RightArm'),
      rightForeArm: find('RightForeArm'),
      rightHand: find('RightHand'),
      rightMiddle: find('RightHandMiddle1'),
      leftMiddle: find('LeftHandMiddle1'),
      leftArm: find('LeftArm'),
      leftForeArm: find('LeftForeArm'),
      leftHand: find('LeftHand'),
      leftUpLeg: find('LeftUpLeg'),
      leftLeg: find('LeftLeg'),
      leftFoot: find('LeftFoot'),
      rightUpLeg: find('RightUpLeg'),
      rightLeg: find('RightLeg'),
      rightFoot: find('RightFoot'),
    }
  }, [model])
  const mixer = useMemo(() => new AnimationMixer(model), [model])
  const actions = useMemo(() => {
    const clip = (name: string) => gltf.animations.find((c) => c.name === name)
    const only = (source: AnimationClip | undefined, part: RegExp, name: string) =>
      source ? new AnimationClip(name, source.duration, source.tracks.filter((t) => part.test(t.name.split('.')[0]!))) : undefined
    const all: Partial<Record<string, AnimationAction>> = {}
    for (const c of gltf.animations) all[c.name] = mixer.clipAction(c)
    const legs = only(clip('run'), LOWER, 'runLegs')
    const arms = only(clip('dribble'), UPPER, 'dribbleArms')
    const crossArms = only(clip('crossover'), UPPER, 'crossArms')
    if (legs) all.runLegs = mixer.clipAction(legs)
    if (arms) all.dribbleArms = mixer.clipAction(arms)
    if (crossArms) all.crossArms = mixer.clipAction(crossArms)
    for (const name of ['jump', 'stumble', 'crossover', 'crossArms', 'dunk']) {
      const action = all[name]
      if (action) {
        action.setLoop(LoopOnce, 1)
        action.clampWhenFinished = true
      }
    }
    return all
  }, [gltf, mixer])

  const pose = useRef<Pose | null>(null)
  // A crossover under way: from the moment it is heard (World.crosses) until its two strokes end.
  const crossing = useRef({ seen: 0, on: false })
  // A dunk under way: from the jump (the game's Player.dunk) until the clip, slam, hang and drop, ends.
  const dunking = useRef({ was: false, on: false })
  const blend = useRef({ shoot: 0, block: 0, reach: 0, rebound: 0, knees: 0 })

  const play = (next: Pose) => {
    if (pose.current === next) return
    const names = (p: Pose | null) =>
      p === null ? [] : p === 'runDribble' ? ['runLegs', 'dribbleArms'] : p === 'runCross' ? ['runLegs', 'crossArms'] : p === 'cross' ? ['crossover'] : [p]
    const leaving = names(pose.current)
    const coming = names(next)
    for (const name of leaving) if (!coming.includes(name)) actions[name]?.fadeOut(0.18)
    for (const name of coming) {
      const action = actions[name]
      if (!action) continue
      if (!leaving.includes(name)) action.reset()
      action.setEffectiveWeight(1).fadeIn(0.18).play()
      if (!['jump', 'stumble', 'crossover', 'crossArms', 'dunk'].includes(name)) action.setLoop(LoopRepeat, Infinity)
    }
    pose.current = next
  }

  useFrame((_, dt) => {
    const { game, marks } = world.current!
    const p = game.players.find((player) => player.id === id)
    if (!p) return
    const ball = game.ball
    if (p.dunk && !dunking.current.was) {
      dunking.current.on = true
      actions.dunk?.reset()
    }
    dunking.current.was = p.dunk
    const dunkClip = actions.dunk
    if (!dunkClip || game.phase === 'over' || (dunkClip.time >= dunkClip.getClip().duration - 1e-3 && p.y === 0 && p.hang === 0)) dunking.current.on = false
    const dunkNow = dunking.current.on && Boolean(dunkClip)
    // A dunk carries its own height (the motion capture's jump); otherwise the game's.
    model.position.set(p.x, dunkNow ? 0 : p.y, p.z)
    // The model faces +z; in the game a player turned 0 faces the basket, along -z.
    model.rotation.y = p.face + Math.PI

    const speed = Math.hypot(p.vx, p.vz)
    const holding = ball.holder === id
    const carrier = ball.holder !== null ? game.players.find((q) => q.id === ball.holder) : undefined
    const guarding = !holding && carrier !== undefined && carrier.team !== p.team && Math.hypot(carrier.x - p.x, carrier.z - p.z) < 3
    // Movement relative to where the player faces: across (to their right) and along.
    const across = p.vx * Math.cos(p.face) - p.vz * Math.sin(p.face)
    const along = -p.vx * Math.sin(p.face) - p.vz * Math.cos(p.face)

    const crossed = world.current!.crosses[id] ?? 0
    if (crossed !== crossing.current.seen) {
      crossing.current.seen = crossed
      crossing.current.on = holding
      actions.crossover?.reset()
      actions.crossArms?.reset()
    }
    const crossAction = speed > 0.6 ? actions.crossArms : actions.crossover
    if (!holding || (crossAction && crossAction.time >= crossAction.getClip().duration - 1e-3)) crossing.current.on = false

    let next: Pose
    if (dunkNow) next = 'dunk'
    else if (game.phase === 'over') next = game.winner === p.team ? 'victory' : 'defeated'
    else if (p.stumble > 0) next = 'stumble'
    // Shooting, or in the air: the body stands (the jump lifts it, and the arms and knees are
    // posed below), rather than Mixamo's big leap.
    else if (p.shootT !== null || p.y > 0.03) next = 'idle'
    else if (holding && crossing.current.on) next = speed > 0.6 ? 'runCross' : 'cross'
    else if (holding) next = speed > 0.6 ? 'runDribble' : 'dribble'
    else if (speed > 0.6) next = guarding && Math.abs(across) > Math.abs(along) ? (across > 0 ? 'strafe_right' : 'strafe_left') : 'run'
    else next = 'idle'
    play(next)

    // Legs keep pace with the ground they cover.
    const pace = (name: string, value: number) => actions[name] && (actions[name]!.timeScale = value)
    pace('run', Math.min(1.6, Math.max(0.6, speed / RUN_SPEED)))
    pace('runLegs', Math.min(1.6, Math.max(0.6, speed / RUN_SPEED)))
    pace('dribble', PACE.dribble)
    pace('dribbleArms', PACE.runDribble)
    pace('crossover', PACE.cross)
    pace('crossArms', PACE.cross)
    pace('strafe_left', Math.min(1.6, Math.max(0.6, Math.abs(across) / STRAFE_SPEED)))
    pace('strafe_right', Math.min(1.6, Math.max(0.6, Math.abs(across) / STRAFE_SPEED)))
    mixer.update(dt)
    model.updateMatrixWorld(true)

    // On top of the movement: a shot, a block, a rebound, a reach, and bent knees in the air.
    const ease = (now: number, goal: number) => now + (goal - now) * Math.min(1, dt * 12)
    const reaching = (marks[id] ?? 0) > performance.now() - 280
    const airborne = p.y > 0.03 && !dunkNow
    const shooting = p.shootT !== null && !dunkNow
    blend.current.shoot = ease(blend.current.shoot, shooting ? 1 : 0)
    blend.current.block = ease(blend.current.block, !shooting && !holding && airborne && ball.holder !== null ? 1 : 0)
    blend.current.rebound = ease(blend.current.rebound, !shooting && airborne && ball.holder === null ? 1 : 0)
    blend.current.reach = ease(blend.current.reach, reaching ? 1 : 0)
    // Knees bend to gather a shot, and stay bent in the air.
    blend.current.knees = ease(blend.current.knees, airborne ? 0.8 : shooting ? 0.55 : 0)
    if (dunkNow) blend.current.shoot = blend.current.block = blend.current.rebound = blend.current.reach = blend.current.knees = 0
    const forward = new Vector3(-Math.sin(p.face), 0, -Math.cos(p.face))
    const right = new Vector3(Math.cos(p.face), 0, -Math.sin(p.face))
    const dir = (f: number, u: number, r: number) => new Vector3().addScaledVector(forward, f).addScaledVector(up, u).addScaledVector(right, r).normalize()
    if (blend.current.knees > 0.01) {
      const w = blend.current.knees
      for (const [thigh, shin, foot] of [
        [bones.leftUpLeg, bones.leftLeg, bones.leftFoot],
        [bones.rightUpLeg, bones.rightLeg, bones.rightFoot],
      ] as const) {
        aim(thigh, shin, dir(0.45, -0.9, 0), w)
        aim(shin, foot, dir(-0.4, -0.9, 0), w)
      }
    }
    if (blend.current.shoot > 0.01) {
      // Shooting form: the shooting arm up with the elbow under the ball, the other hand guiding
      // it from the side.
      const w = blend.current.shoot
      aim(bones.rightArm, bones.rightForeArm, dir(0.62, 0.78, 0.08), w)
      aim(bones.rightForeArm, bones.rightHand, dir(0.25, 0.97, -0.05), w)
      aim(bones.leftArm, bones.leftForeArm, dir(0.6, 0.55, -0.35), w)
      aim(bones.leftForeArm, bones.leftHand, dir(0.2, 0.85, 0.45), w)
    }
    if (blend.current.block > 0.01) {
      // A contest: one arm high toward the ball, the other out for balance.
      const w = blend.current.block
      aim(bones.rightArm, bones.rightForeArm, dir(0.3, 0.95, 0), w)
      aim(bones.rightForeArm, bones.rightHand, dir(0.25, 0.97, 0), w)
      aim(bones.leftArm, bones.leftForeArm, dir(0.25, 0.35, -0.9), w * 0.8)
      aim(bones.leftForeArm, bones.leftHand, dir(0.3, 0.6, -0.7), w * 0.8)
    }
    if (blend.current.rebound > 0.01) {
      // Both hands up and forward, for the ball coming down.
      const w = blend.current.rebound
      aim(bones.rightArm, bones.rightForeArm, dir(0.5, 0.85, 0.12), w)
      aim(bones.rightForeArm, bones.rightHand, dir(0.4, 0.9, 0), w)
      aim(bones.leftArm, bones.leftForeArm, dir(0.5, 0.85, -0.12), w)
      aim(bones.leftForeArm, bones.leftHand, dir(0.4, 0.9, 0), w)
    }
    if (blend.current.reach > 0.01) {
      const w = blend.current.reach
      aim(bones.rightArm, bones.rightForeArm, dir(1, -0.35, 0.05), w)
      aim(bones.rightForeArm, bones.rightHand, dir(1, -0.4, 0), w)
    }
    // Where the right hand is, for drawing the ball in it.
    if (bones.rightHand) world.current!.hands[id] = bones.rightHand
    // The ball in the dribble, as drawn: pushed down from under one palm at the top of a stroke,
    // to the floor half way, and up into the same palm (a dribble) or the other (a crossover).
    if (dunkNow && holding && bones.rightHand && bones.rightMiddle && bones.leftHand && bones.leftMiddle) {
      // Both hands on the ball, overhead, until it goes through.
      bones.rightHand.getWorldPosition(palmA).lerp(bones.rightMiddle.getWorldPosition(handTip), 0.6)
      bones.leftHand.getWorldPosition(palmB).lerp(bones.leftMiddle.getWorldPosition(handTip), 0.6)
      const drawn = (world.current!.dribble[id] ??= { phase: 0, at: new Vector3() })
      drawn.phase = 0
      drawn.at.copy(palmA).add(palmB).multiplyScalar(0.5)
      return
    }
    const crossNow = pose.current === 'cross' || pose.current === 'runCross'
    const stroke = crossNow ? crossAction : pose.current === 'runDribble' ? actions.dribbleArms : pose.current === 'dribble' ? actions.dribble : undefined
    if (holding && !shooting && !airborne && stroke && bones.rightHand && bones.rightMiddle && bones.leftHand && bones.leftMiddle) {
      const strokes = crossNow ? CROSS_HANDS.length - 1 : DRIBBLE_CYCLES
      const through = Math.min(0.9999, stroke.time / stroke.getClip().duration) * strokes
      const k = Math.floor(through)
      const phase = through - k
      const palmOf = (side: 'left' | 'right', into: Vector3) => {
        const [hand, middle] = side === 'right' ? [bones.rightHand!, bones.rightMiddle!] : [bones.leftHand!, bones.leftMiddle!]
        hand.getWorldPosition(into)
        middle.getWorldPosition(handTip)
        return into.lerp(handTip, 0.6)
      }
      const from = palmOf(crossNow ? CROSS_HANDS[k]! : 'right', palmA)
      const to = palmOf(crossNow ? CROSS_HANDS[k + 1]! : 'right', palmB)
      const drawn = (world.current!.dribble[id] ??= { phase: 0, at: new Vector3() })
      drawn.phase = phase
      const under = (palm: Vector3) => palm.y - BALL_R - 0.02
      const high = under(from) + (under(to) - under(from)) * phase
      const depth = 1 - Math.abs(2 * phase - 1)
      drawn.at.set(from.x + (to.x - from.x) * phase, high + (BALL_R - high) * depth, from.z + (to.z - from.z) * phase)
    } else delete world.current!.dribble[id]
  })

  return <primitive object={model} />
}

/** Every player as the character. Suspends while the model downloads (the stand-ins show meanwhile). */
export function Athletes({ world }: { world: RefObject<World> }) {
  const gltf = useLoader(GLTFLoader, CHARACTER_URL)
  return (
    <>
      {world.current!.game.players.map((p) => (
        <Athlete key={p.id} gltf={gltf} world={world} id={p.id} />
      ))}
    </>
  )
}
