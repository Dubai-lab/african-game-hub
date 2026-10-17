// The players as real characters: a model made in Blender from Mixamo downloads
// (scripts/makeBasketballCharacter.py), with its movements, chosen sixty times a second from
// what the simulation says each player is doing:
//
//   standing ............ idle             with the ball, standing ... dribble
//   running ............. run              with the ball, running .... run on the legs + dribble on the arms
//   guarding, sliding ... strafe left/right
//   in the air .......... jump, the arms raised by hand for a shot or a block
//   beaten by a crossover  stumble          game over ................ victory / defeated
//
// A shot, a block and a reach for the ball are made by turning the arm bones toward where the
// hands must go, on top of the movement playing: Mixamo has no jump shot, and this way any
// Mixamo character works without one. It decides nothing about the game.
import { useFrame, useLoader } from '@react-three/fiber'
import { type RefObject, useMemo, useRef } from 'react'
import { type AnimationAction, AnimationClip, AnimationMixer, type Bone, LoopOnce, LoopRepeat, type Object3D, Quaternion, Vector3 } from 'three'
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { World } from './Court3D'

export const CHARACTER_URL = '/basketball/player1.glb'

// Which bones belong to the legs and which to the arms, for playing two movements at once.
const LOWER = /(Hips|UpLeg|Leg|Foot|Toe)/
const UPPER = /(Spine|Neck|Head|Shoulder|Arm|Hand)/
// The natural speed of the movements as they were made (metres a second).
const RUN_SPEED = 5.1
const STRAFE_SPEED = 3.9

type Pose = 'idle' | 'dribble' | 'run' | 'runDribble' | 'strafe_left' | 'strafe_right' | 'jump' | 'stumble' | 'victory' | 'defeated'

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

function Athlete({ gltf, world, id }: { gltf: GLTF; world: RefObject<World>; id: number }) {
  const model = useMemo(() => {
    const copy = cloneSkinned(gltf.scene)
    copy.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) {
        o.castShadow = true
        o.frustumCulled = false
      }
    })
    return copy
  }, [gltf])
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
      leftArm: find('LeftArm'),
      leftForeArm: find('LeftForeArm'),
      leftHand: find('LeftHand'),
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
    if (legs) all.runLegs = mixer.clipAction(legs)
    if (arms) all.dribbleArms = mixer.clipAction(arms)
    for (const name of ['jump', 'stumble']) {
      const action = all[name]
      if (action) {
        action.setLoop(LoopOnce, 1)
        action.clampWhenFinished = true
      }
    }
    return all
  }, [gltf, mixer])

  const pose = useRef<Pose | null>(null)
  const blend = useRef({ shoot: 0, block: 0, reach: 0 })

  const play = (next: Pose) => {
    if (pose.current === next) return
    const names = (p: Pose | null) => (p === null ? [] : p === 'runDribble' ? ['runLegs', 'dribbleArms'] : [p])
    const leaving = names(pose.current)
    const coming = names(next)
    for (const name of leaving) if (!coming.includes(name)) actions[name]?.fadeOut(0.18)
    for (const name of coming) {
      const action = actions[name]
      if (!action) continue
      if (!leaving.includes(name)) action.reset()
      action.setEffectiveWeight(1).fadeIn(0.18).play()
      if (name !== 'jump' && name !== 'stumble') action.setLoop(LoopRepeat, Infinity)
    }
    pose.current = next
  }

  useFrame((_, dt) => {
    const { game, marks } = world.current!
    const p = game.players.find((player) => player.id === id)
    if (!p) return
    const ball = game.ball
    model.position.set(p.x, p.y * 0.6, p.z)
    // The model faces +z; in the game a player turned 0 faces the basket, along -z.
    model.rotation.y = p.face + Math.PI

    const speed = Math.hypot(p.vx, p.vz)
    const holding = ball.holder === id
    const carrier = ball.holder !== null ? game.players.find((q) => q.id === ball.holder) : undefined
    const guarding = !holding && carrier !== undefined && carrier.team !== p.team && Math.hypot(carrier.x - p.x, carrier.z - p.z) < 3
    // Movement relative to where the player faces: across (to their right) and along.
    const across = p.vx * Math.cos(p.face) - p.vz * Math.sin(p.face)
    const along = -p.vx * Math.sin(p.face) - p.vz * Math.cos(p.face)

    let next: Pose
    if (game.phase === 'over') next = game.winner === p.team ? 'victory' : 'defeated'
    else if (p.stumble > 0) next = 'stumble'
    else if (p.shootT !== null || p.y > 0.05) next = 'jump'
    else if (holding) next = speed > 0.6 ? 'runDribble' : 'dribble'
    else if (speed > 0.6) next = guarding && Math.abs(across) > Math.abs(along) ? (across > 0 ? 'strafe_right' : 'strafe_left') : 'run'
    else next = 'idle'
    play(next)

    // Legs keep pace with the ground they cover.
    const pace = (name: string, value: number) => actions[name] && (actions[name]!.timeScale = value)
    pace('run', Math.min(1.6, Math.max(0.6, speed / RUN_SPEED)))
    pace('runLegs', Math.min(1.6, Math.max(0.6, speed / RUN_SPEED)))
    pace('strafe_left', Math.min(1.6, Math.max(0.6, Math.abs(across) / STRAFE_SPEED)))
    pace('strafe_right', Math.min(1.6, Math.max(0.6, Math.abs(across) / STRAFE_SPEED)))
    pace('jump', 1.5)
    mixer.update(dt)
    model.updateMatrixWorld(true)

    // The arms, on top of the movement: up to shoot, straight up to block, out to reach.
    const ease = (now: number, goal: number) => now + (goal - now) * Math.min(1, dt * 14)
    const reaching = (marks[id] ?? 0) > performance.now() - 280
    blend.current.shoot = ease(blend.current.shoot, p.shootT !== null ? 1 : 0)
    blend.current.block = ease(blend.current.block, p.shootT === null && !holding && p.y > 0.05 ? 1 : 0)
    blend.current.reach = ease(blend.current.reach, reaching ? 1 : 0)
    const forward = new Vector3(-Math.sin(p.face), 0, -Math.cos(p.face))
    if (blend.current.shoot > 0.01) {
      const lift = new Vector3().copy(up).multiplyScalar(0.92).addScaledVector(forward, 0.38).normalize()
      aim(bones.rightArm, bones.rightForeArm, lift, blend.current.shoot)
      aim(bones.rightForeArm, bones.rightHand, up, blend.current.shoot)
      aim(bones.leftArm, bones.leftForeArm, lift, blend.current.shoot * 0.9)
      aim(bones.leftForeArm, bones.leftHand, up, blend.current.shoot * 0.9)
    }
    if (blend.current.block > 0.01) {
      aim(bones.rightArm, bones.rightForeArm, up, blend.current.block)
      aim(bones.rightForeArm, bones.rightHand, up, blend.current.block)
      aim(bones.leftArm, bones.leftForeArm, up, blend.current.block)
      aim(bones.leftForeArm, bones.leftHand, up, blend.current.block)
    }
    if (blend.current.reach > 0.01) {
      const low = new Vector3().copy(forward).addScaledVector(up, -0.35).normalize()
      aim(bones.rightArm, bones.rightForeArm, low, blend.current.reach)
      aim(bones.rightForeArm, bones.rightHand, low, blend.current.reach)
    }
    // Where the right hand is, for drawing the ball in it.
    if (bones.rightHand) world.current!.hands[id] = bones.rightHand
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
