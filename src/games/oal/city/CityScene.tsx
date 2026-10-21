// One Africa Life: the town as one place, walked by the player's own character (as in a game:
// no screens between, no edge). Made in the browser from the town's real map (./cityGen.ts),
// chunk by chunk around the player as they go, the far ones let go; the streets built by hand
// (Tubman Boulevard at Sinkor) set into it where they are, with their traffic and people; the
// family's compound and the Ministry of Health where they are, each with its gate. The ground,
// the haze and the sky go on to the horizon. Loaded only here.
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Component, type ReactNode, type RefObject, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  AdditiveBlending,
  BackSide,
  type DirectionalLight,
  type HemisphereLight,
  PointLight,
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  BufferGeometry as BufferGeometryClass,
  CylinderGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  type Group,
  Group as ThreeGroup,
  Mesh,
  MeshBasicMaterial,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Plane,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  SphereGeometry,
  type SkinnedMesh,
  SRGBColorSpace,
  type Texture,
  Vector3,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Appearance } from '../../../../supabase/functions/_shared/oal'
import { person, type Stick } from '../ArrivalsScene'
import { CHARACTER_URL, CROWD_URL } from '../character'
import { type TownMap, useTownMap } from '../MapView'
import { TOWNS } from '../StreetScene'
import { keepOutOf, type Moving, Traffic } from '../Traffic'
import { businessKey, INSIDE_OF } from './business'
import { CityTraffic, CityWalkers } from './CityTraffic'
import { type Destination, newRide, PASSENGER, type RidePhase, type RideState } from './ride'
import { type Sign, SIGNAL_LAMPS, TREE_KINDS, type Signal, type SignalLamp, signalState, type TilePlace } from './cityGen'
import { groundHeight } from './cityGen'
import { type ChunkRequest } from './chunk.worker'
import { type PackedParts, unpackParts } from './chunkPack'
import { cityNight } from './night'
import { CAR_PLANS, CARS_URL, buildCar, poseCar } from './cars'
import { driveOwn, outline, ownCar, type OwnCarPhase } from './ownCar'
import { overlaps } from './driving'
import { type Landmark, LANDMARKS, landmarkPoint, landmarkSolids } from './landmarks'
import { COMPOUNDS_BUILT, gates, HOME_URL, INSIDES, INTERIORS_URL, OUTSIDE } from '../homeModel'
import { stillFigure, VEHICLES_URL, vehicleModels } from '../Traffic'
import { defaultAppearance } from '../../../../supabase/functions/_shared/oal'
import { buildChunk, buildCity, CHUNK, solidOf, type City, type ChunkParts, type Keep, nearestRoad, segsNear, type Solid, type Tile, toSeg, type TownMapData, waterGeometry } from './cityGen'

const WALK_SPEED = 1.45
const RADIUS = 0.3
const NEAR = 2.6
// Chunks kept round the player (this many either side), and built one a frame.
const AROUND = 2

/** A place in the town: what, where, which way one faces it. */
export type CityPlace = { name: string; x: number; y: number; face: number[]; out?: number; exit?: [number, number] }

// ---- Textures, drawn in code (nothing to download) --------------------------------------------

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = true): Texture {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')!
  draw(g, size)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping
  t.anisotropy = 4
  return t
}

function noise(g: CanvasRenderingContext2D, s: number, base: string, spots: [string, number, number][]) {
  g.fillStyle = base
  g.fillRect(0, 0, s, s)
  let seed = 7
  const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  for (const [colour, count, size] of spots) {
    g.fillStyle = colour
    for (let i = 0; i < count; i++) {
      const w = size * (0.4 + r())
      g.globalAlpha = 0.25 + r() * 0.5
      g.fillRect(r() * s, r() * s, w, w * (0.5 + r()))
    }
  }
  g.globalAlpha = 1
}

/** Soft round patches (grass on laterite, darker earth): no hard edges, tiling. */
function blobs(g: CanvasRenderingContext2D, s: number, base: string, spots: [string, number, number][]) {
  g.fillStyle = base
  g.fillRect(0, 0, s, s)
  let seed = 11
  const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  const c = new Color()
  for (const [colour, count, size] of spots) {
    c.set(colour)
    const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`
    for (let i = 0; i < count; i++) {
      const x = r() * s
      const y = r() * s
      const rad = size * (0.4 + r())
      const a = 0.25 + r() * 0.45
      // Drawn at each wrap too, so the tile repeats without a seam.
      for (const ox of [-s, 0, s])
        for (const oy of [-s, 0, s]) {
          const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad)
          grd.addColorStop(0, `rgba(${rgb},${a})`)
          grd.addColorStop(1, `rgba(${rgb},0)`)
          g.fillStyle = grd
          g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2)
        }
    }
  }
}

/** A seeded random for drawing. */
function drawRandom(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
}

/** The facade atlas (512 px, four 256 px tiles; tile n at column n % 2, row n / 2 from the
 * bottom, v up): each tile is a wall 4 m wide, 3.1 m high. Lit: black but the windows. */
function facadeAtlas(g: CanvasRenderingContext2D, lit: boolean) {
  const s = 256
  g.fillStyle = '#000000'
  g.fillRect(0, 0, 512, 512)
  const tile = (n: number, draw: (window: (x: number, y: number, w: number, h: number) => void) => void) => {
    g.save()
    g.translate((n % 2) * s, (1 - Math.floor(n / 2)) * s)
    g.beginPath()
    g.rect(0, 0, s, s)
    g.clip()
    draw((x, y, w, h) => {
      if (!lit) return
      g.fillStyle = '#ffd890'
      g.fillRect(x, y, w, h)
    })
    g.restore()
  }
  const plaster = (base: string, seed: number) => {
    if (lit) return
    g.fillStyle = base
    g.fillRect(0, 0, s, s)
    const r = drawRandom(seed)
    for (let i = 0; i < 260; i++) {
      g.globalAlpha = 0.08 + r() * 0.12
      g.fillStyle = r() < 0.5 ? '#c8c4bc' : '#ffffff'
      const w = 4 + r() * 14
      g.fillRect(r() * s, r() * s, w, w * (0.4 + r()))
    }
    // Rain streaks down from the top, the red dust splashed up the foot.
    for (let i = 0; i < 7; i++) {
      g.globalAlpha = 0.06 + r() * 0.08
      g.fillStyle = '#5a5248'
      g.fillRect(r() * s, 0, 2 + r() * 5, s * (0.2 + r() * 0.5))
    }
    g.globalAlpha = 1
    const grd = g.createLinearGradient(0, s, 0, s * 0.82)
    grd.addColorStop(0, 'rgba(150,80,50,0.5)')
    grd.addColorStop(1, 'rgba(150,80,50,0)')
    g.fillStyle = grd
    g.fillRect(0, s * 0.82, s, s * 0.18)
  }
  const rect = (colour: string, x: number, y: number, w: number, h: number) => {
    if (lit) return
    g.fillStyle = colour
    g.fillRect(x, y, w, h)
  }
  const glass = (x: number, y: number, w: number, h: number, tone: string, curtain: string) => {
    rect(tone, x, y, w, h)
    rect(curtain, x + w * 0.05, y + h * 0.08, w * 0.4, h * 0.84)
    rect('rgba(255,255,255,0.12)', x + w * 0.55, y + h * 0.08, w * 0.4, h * 0.3)
  }
  const line = (colour: string, width: number, pts: number[][]) => {
    if (lit) return
    g.strokeStyle = colour
    g.lineWidth = width
    g.beginPath()
    g.moveTo(pts[0]![0]!, pts[0]![1]!)
    for (const p of pts.slice(1)) g.lineTo(p[0]!, p[1]!)
    g.stroke()
  }

  // 0, a house: white plaster, the maroon base and sill, a wide window behind burglar bars
  // (squares, a diamond in each), the fascia's maroon line at the top.
  tile(0, (window) => {
    plaster('#f4f4f2', 3)
    const wx = s * 0.16
    const wy = s * 0.24
    const ww = s * 0.68
    const wh = s * 0.4
    glass(wx, wy, ww, wh, '#1c2428', '#4a3a3a')
    window(wx + 3, wy + 3, ww - 6, wh - 6)
    for (let i = 0; i <= 6; i++) line('#3a1a16', 3, [[wx + (ww * i) / 6, wy], [wx + (ww * i) / 6, wy + wh]])
    for (let j = 0; j <= 3; j++) line('#3a1a16', 3, [[wx, wy + (wh * j) / 3], [wx + ww, wy + (wh * j) / 3]])
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 3; j++) {
        const cx = wx + (ww * (i + 0.5)) / 6
        const cy = wy + (wh * (j + 0.5)) / 3
        const rx = ww / 12
        const ry = wh / 6
        line('#3a1a16', 2, [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy], [cx, cy - ry]])
      }
    rect('#7a2420', wx - 6, wy + wh, ww + 12, 9)
    rect('rgba(0,0,0,0.25)', wx - 6, wy + wh + 9, ww + 12, 3)
    rect('#7a2420', 0, s * 0.84, s, s * 0.16)
    rect('rgba(0,0,0,0.2)', 0, s * 0.84, s, 3)
    rect('#7a2420', 0, 0, s, 7)
  })

  // 1, a painted wall (compounds, rows of shops' upper floors): a darker band at the foot, a
  // small louvre window with its green glass, a drain pipe.
  tile(1, (window) => {
    plaster('#f2f0e8', 5)
    rect('rgba(60,50,40,0.35)', 0, s * 0.88, s, s * 0.12)
    const wx = s * 0.34
    const wy = s * 0.3
    const ww = s * 0.36
    const wh = s * 0.3
    rect('#d8d8d4', wx - 5, wy - 5, ww + 10, wh + 10)
    rect('#2a4a3a', wx, wy, ww, wh)
    window(wx + 2, wy + 2, ww - 4, wh - 4)
    for (let y = wy + 5; y < wy + wh; y += 7) rect('rgba(150,200,170,0.45)', wx + 2, y, ww - 4, 3)
    line('#9a9a96', 3, [[wx + ww / 2, wy], [wx + ww / 2, wy + wh]])
    rect('rgba(0,0,0,0.2)', wx - 5, wy + wh + 5, ww + 10, 4)
    rect('#d0ccc4', s * 0.92, 0, 6, s)
    rect('rgba(0,0,0,0.15)', s * 0.92 + 6, 0, 2, s)
  })

  // 2, concrete blocks not yet plastered: grey courses (40 by 20 cm), mortar, stains, a
  // window opening with wire mesh and a wooden frame.
  tile(2, (window) => {
    if (!lit) {
      g.fillStyle = '#b4b0a8'
      g.fillRect(0, 0, s, s)
      const r = drawRandom(13)
      const bh = s / 15.5
      const bw = s / 10
      for (let row = 0; row < 16; row++)
        for (let col = -1; col < 11; col++) {
          const x = col * bw + (row % 2 ? bw / 2 : 0)
          const y = row * bh
          const v = 160 + Math.floor(r() * 40)
          g.fillStyle = `rgb(${v},${v - 4},${v - 10})`
          g.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3)
          if (r() < 0.25) {
            g.fillStyle = 'rgba(90,85,75,0.25)'
            g.fillRect(x + r() * bw * 0.5, y + 2, bw * 0.4, bh - 4)
          }
        }
      const grd = g.createLinearGradient(0, s, 0, s * 0.7)
      grd.addColorStop(0, 'rgba(70,60,40,0.55)')
      grd.addColorStop(1, 'rgba(70,60,40,0)')
      g.fillStyle = grd
      g.fillRect(0, s * 0.7, s, s * 0.3)
    }
    const wx = s * 0.3
    const wy = s * 0.28
    const ww = s * 0.4
    const wh = s * 0.32
    rect('#5a4430', wx - 6, wy - 6, ww + 12, wh + 12)
    rect('#181410', wx, wy, ww, wh)
    window(wx, wy, ww, wh)
    for (let x = wx; x <= wx + ww; x += 5) line('rgba(120,120,110,0.6)', 1, [[x, wy], [x, wy + wh]])
    for (let y = wy; y <= wy + wh; y += 5) line('rgba(120,120,110,0.6)', 1, [[wx, y], [wx + ww, y]])
  })

  // 3, a storey of flats or offices: the slab's band at the top, two windows in aluminium
  // frames with green glass, a balcony rail before them, an AC box.
  tile(3, (window) => {
    plaster('#f4f2ea', 7)
    rect('rgba(90,80,60,0.28)', 0, 0, s, s * 0.09)
    rect('rgba(0,0,0,0.18)', 0, s * 0.09, s, 3)
    for (const wx of [s * 0.08, s * 0.54]) {
      const wy = s * 0.24
      const ww = s * 0.38
      const wh = s * 0.42
      rect('#c8ccd0', wx - 4, wy - 4, ww + 8, wh + 8)
      glass(wx, wy, ww, wh, '#2a4a44', '#6a7a70')
      window(wx + 2, wy + 2, ww - 4, wh - 4)
      line('#c8ccd0', 3, [[wx + ww / 2, wy], [wx + ww / 2, wy + wh]])
    }
    // The rail along the storey, its uprights.
    line('#3a3a3a', 3, [[0, s * 0.62], [s, s * 0.62]])
    for (let x = 4; x < s; x += 10) line('#3a3a3a', 1.5, [[x, s * 0.62], [x, s * 0.8]])
    rect('#e8e4d8', 0, s * 0.8, s, s * 0.06)
    rect('rgba(0,0,0,0.2)', 0, s * 0.86, s, 3)
    rect('#d8d8d4', s * 0.78, s * 0.08 + 6, s * 0.16, s * 0.1)
    rect('rgba(0,0,0,0.3)', s * 0.8, s * 0.1 + 6, s * 0.12, 2)
  })
}

/** The walls' material reads the facade atlas: the tile (v / 100, WALL_STYLE) and, within it,
 * where on the wall (fract), its slope kept so mipmaps don't seam. At night some windows lit. */
function atlasWalls(m: MeshStandardMaterial) {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
vec2 atlasUv(vec2 uv) {
  float st = floor(uv.y / 100.0);
  vec2 f = clamp(fract(vec2(uv.x, uv.y - st * 100.0)), 0.006, 0.994);
  return (f + vec2(mod(st, 2.0), floor(st / 2.0))) * 0.5;
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec4 sampledDiffuseColor = textureGrad(map, atlasUv(vMapUv), dFdx(vMapUv) * 0.5, dFdy(vMapUv) * 0.5);
  diffuseColor *= sampledDiffuseColor;
#endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#ifdef USE_EMISSIVEMAP
  vec4 emissiveColor = textureGrad(emissiveMap, atlasUv(vEmissiveMapUv), dFdx(vEmissiveMapUv) * 0.5, dFdy(vEmissiveMapUv) * 0.5);
  vec2 cell = floor(vEmissiveMapUv);
  totalEmissiveRadiance *= emissiveColor.rgb * step(0.45, fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453));
#endif`,
      )
  }
  m.customProgramCacheKey = () => 'oal-walls-atlas'
  return m
}

let sharedTextures: ReturnType<typeof makeTextures> | null = null
function useTextures() {
  return useMemo(() => (sharedTextures ??= makeTextures()), [])
}
function makeTextures() {
  return (() => {
    const ground = canvasTexture(512, (g, s) => blobs(g, s, '#94684a', [['#6f8a3a', 90, 60], ['#5f7f34', 50, 90], ['#a8774f', 260, 24], ['#7a5236', 300, 10], ['#86a04a', 120, 30]]))
    // Laterite, 4 m along by the road's width across: red earth and stones, two tyre ruts worn
    // darker along it, potholes now and then with rain standing in them.
    const dirt = canvasTexture(512, (g, s) => {
      noise(g, s, '#9a5a38', [['#b06a42', 900, 6], ['#7a4428', 500, 5], ['#c08058', 400, 3], ['#6a3a22', 120, 9]])
      for (const v of [0.3, 0.7]) {
        const grd = g.createLinearGradient(0, s * (v - 0.08), 0, s * (v + 0.08))
        grd.addColorStop(0, 'rgba(90,45,25,0)')
        grd.addColorStop(0.5, 'rgba(90,45,25,0.45)')
        grd.addColorStop(1, 'rgba(90,45,25,0)')
        g.fillStyle = grd
        g.fillRect(0, s * (v - 0.08), s, s * 0.16)
      }
      let seed = 5
      const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
      for (let i = 0; i < 5; i++) {
        const x = r() * s
        const y = s * (0.2 + r() * 0.6)
        const w = 14 + r() * 26
        g.fillStyle = 'rgba(70,35,20,0.75)'
        g.beginPath()
        g.ellipse(x, y, w, w * 0.55, r() * 3, 0, Math.PI * 2)
        g.fill()
        if (r() < 0.5) {
          g.fillStyle = 'rgba(120,130,140,0.55)'
          g.beginPath()
          g.ellipse(x, y, w * 0.6, w * 0.3, 0, 0, Math.PI * 2)
          g.fill()
        }
      }
    })
    // Tarmac, 4 m along: its stones, the tyres' polish in two bands, patches, cracks, oil.
    const asphalt = canvasTexture(512, (g, s) => {
      noise(g, s, '#45464a', [['#36373a', 1400, 3], ['#55565a', 1000, 2], ['#2e2f32', 80, 16]])
      for (const v of [0.27, 0.73]) {
        const grd = g.createLinearGradient(0, s * (v - 0.1), 0, s * (v + 0.1))
        grd.addColorStop(0, 'rgba(20,20,22,0)')
        grd.addColorStop(0.5, 'rgba(20,20,22,0.28)')
        grd.addColorStop(1, 'rgba(20,20,22,0)')
        g.fillStyle = grd
        g.fillRect(0, s * (v - 0.1), s, s * 0.2)
      }
      let seed = 9
      const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
      for (let i = 0; i < 4; i++) {
        g.fillStyle = r() < 0.5 ? 'rgba(30,30,32,0.55)' : 'rgba(90,90,92,0.35)'
        g.fillRect(r() * s, r() * s, 40 + r() * 90, 30 + r() * 70)
      }
      g.strokeStyle = 'rgba(15,15,16,0.7)'
      g.lineWidth = 1.5
      for (let i = 0; i < 9; i++) {
        let x = r() * s
        let y = r() * s
        g.beginPath()
        g.moveTo(x, y)
        for (let k = 0; k < 6; k++) {
          x += (r() - 0.5) * 40
          y += (r() - 0.5) * 40
          g.lineTo(x, y)
        }
        g.stroke()
      }
      for (let i = 0; i < 3; i++) {
        g.fillStyle = 'rgba(10,10,12,0.3)'
        g.beginPath()
        g.ellipse(r() * s, s * (0.3 + r() * 0.4), 12 + r() * 14, 6 + r() * 6, 0, 0, Math.PI * 2)
        g.fill()
      }
    })
    const pavement = canvasTexture(256, (g, s) => {
      noise(g, s, '#b8b0a2', [['#a49c8e', 500, 3], ['#c8c0b2', 300, 3], ['#8a6a4a', 60, 10]])
      g.strokeStyle = 'rgba(80,70,60,0.5)'
      g.lineWidth = 2
      for (let i = 0; i <= s; i += s / 4) {
        g.beginPath()
        g.moveTo(i, 0)
        g.lineTo(i, s)
        g.stroke()
      }
    })
    // The walls, four styles (WALL_STYLE) in one atlas, each 4 m wide and a storey high, as
    // Monrovia's photos show them; at night, their windows lit.
    const facade = canvasTexture(512, (g) => facadeAtlas(g, false), false)
    const windowsLit = canvasTexture(512, (g) => facadeAtlas(g, true), false)
    // Corrugated zinc, gone to rust in streaks.
    const zinc = canvasTexture(128, (g, s) => {
      g.fillStyle = '#d8d8d8'
      g.fillRect(0, 0, s, s)
      for (let i = 0; i < s; i += 8) {
        g.fillStyle = 'rgba(0,0,0,0.18)'
        g.fillRect(i, 0, 3, s)
      }
      noise(g, 0, '#000', [])
      let seed = 3
      const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(120,60,30,${0.15 + r() * 0.3})`
        g.fillRect(r() * s, r() * s, 4 + r() * 10, 20 + r() * 50)
      }
    })
    // A shopfront 4 m wide, a storey high: the painted sign board along the top, the steel
    // shutter rolled half up over the dark shop, its frame.
    const shopfront = canvasTexture(256, (g, s) => {
      noise(g, s, '#f2f2f2', [['#dcdcdc', 200, 6]])
      g.fillStyle = '#ffffff'
      g.fillRect(0, 0, s, s * 0.22)
      g.fillStyle = 'rgba(0,0,0,0.25)'
      g.fillRect(0, s * 0.22, s, 4)
      g.fillStyle = '#26221e'
      g.fillRect(s * 0.08, s * 0.3, s * 0.84, s * 0.7)
      // The shutter's slats, rolled down to half the opening.
      for (let y = s * 0.3; y < s * 0.62; y += 6) {
        g.fillStyle = y % 12 < 6 ? '#8e9092' : '#a6a8aa'
        g.fillRect(s * 0.08, y, s * 0.84, 6)
      }
      g.fillStyle = '#5a4a3a'
      g.fillRect(s * 0.15, s * 0.7, s * 0.7, s * 0.06)
      g.strokeStyle = '#4a4a4a'
      g.lineWidth = 6
      g.strokeRect(s * 0.08, s * 0.3, s * 0.84, s * 0.7)
    })
    // At night: a shop's inside lit.
    const shopLit = canvasTexture(256, (g, s) => {
      g.fillStyle = '#000000'
      g.fillRect(0, 0, s, s)
      g.fillStyle = '#ffe0a0'
      g.fillRect(s * 0.1, s * 0.62, s * 0.8, s * 0.36)
      g.fillStyle = '#806040'
      g.fillRect(0, 0, s, s * 0.22)
    })
    return { ground, dirt, asphalt, pavement, facade, zinc, shopfront, windowsLit, shopLit }
  })()
}

let sharedMaterials: ReturnType<typeof makeMaterials> | null = null
function useMaterials() {
  const tex = useTextures()
  return useMemo(() => (sharedMaterials ??= makeMaterials(tex)), [tex])
}
function makeMaterials(tex: ReturnType<typeof useTextures>) {
  return {
      ground: new MeshStandardMaterial({ map: tex.ground, roughness: 1 }),
      dirt: new MeshStandardMaterial({ map: tex.dirt, roughness: 1, vertexColors: true, side: DoubleSide }),
      asphalt: new MeshStandardMaterial({ map: tex.asphalt, roughness: 0.85, vertexColors: true, side: DoubleSide }),
      pavement: new MeshStandardMaterial({ map: tex.pavement, roughness: 0.95, vertexColors: true, side: DoubleSide }),
      marks: new MeshStandardMaterial({ color: '#f2f0e6', roughness: 0.8, vertexColors: true, side: DoubleSide }),
      walls: atlasWalls(new MeshStandardMaterial({ map: tex.facade, roughness: 0.9, vertexColors: true, side: DoubleSide, emissiveMap: tex.windowsLit, emissive: new Color('#ffcf80'), emissiveIntensity: 0 })),
      shops: new MeshStandardMaterial({ map: tex.shopfront, roughness: 0.85, vertexColors: true, side: DoubleSide, emissiveMap: tex.shopLit, emissive: new Color('#ffd9a0'), emissiveIntensity: 0 }),
      // The lamps' glass (grey by day, lit at night) and the pools of light under them.
      glow: new MeshBasicMaterial({ color: '#b8b8b0', toneMapped: false }),
      pools: new MeshBasicMaterial({ color: '#ffd59a', transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, toneMapped: false }),
      // The traffic lights' lamps: each way's red, amber, green (lit or dark by the cycle).
      ...Object.fromEntries(SIGNAL_LAMPS.map((k) => [`sig${k}`, new MeshBasicMaterial({ color: '#202020', toneMapped: false })])) as Record<`sig${SignalLamp}`, MeshBasicMaterial>,
      land: new MeshStandardMaterial({ roughness: 1, vertexColors: true, side: DoubleSide }),
      roofs: new MeshStandardMaterial({ map: tex.zinc, roughness: 0.6, metalness: 0.3, vertexColors: true, side: DoubleSide }),
      plain: new MeshStandardMaterial({ roughness: 0.85, vertexColors: true, side: DoubleSide }),
      leaves: new MeshStandardMaterial({ roughness: 0.8, vertexColors: true, side: DoubleSide }),
      sea: new MeshStandardMaterial({ color: '#2f6a8a', roughness: 0.25, metalness: 0.1, side: DoubleSide }),
      water: new MeshStandardMaterial({ color: '#3a6a6a', roughness: 0.3, side: DoubleSide }),
      wet: new MeshStandardMaterial({ color: '#4a6a3a', roughness: 1, side: DoubleSide }),
  }
}
type Materials = ReturnType<typeof useMaterials>

// ---- The town, chunk by chunk ----------------------------------------------------------------

type Built = { group: Group; parts: ChunkParts; dispose?: () => void }

/** The chunks round the player, built as they come near and let go behind. */
/** The working street lamps of the chunks built (town metres and height), by chunk. */
const lampsByChunk = new Map<string, number[][]>()
/** The places of the chunks built (their doors, by chunk), and the signs' materials (lit at night). */
const placesByChunk = new Map<string, TilePlace[]>()
const signMaterials = new Set<MeshStandardMaterial>()

/** How each kind of place's sign board looks: its ground, its letters, a mark. */
const SIGN_STYLE: Record<string, { bg: string; fg: string; mark?: string }> = {
  street: { bg: '#1f5a3a', fg: '#ffffff' },
  health: { bg: '#ffffff', fg: '#c8281e', mark: '+' },
  pharmacy: { bg: '#2f8a4a', fg: '#ffffff', mark: '+' },
  school: { bg: '#1f4fa8', fg: '#ffffff' },
  church: { bg: '#f4f0e6', fg: '#3a2a6a', mark: '✝' },
  mosque: { bg: '#1f6a3a', fg: '#ffffff', mark: '☪' },
  government: { bg: '#1f5a3a', fg: '#f4efe2' },
  embassy: { bg: '#1a2440', fg: '#ffffff' },
  hotel: { bg: '#1a2440', fg: '#e2b62a' },
  food: { bg: '#c8281e', fg: '#ffe08a' },
  fun: { bg: '#141414', fg: '#ff4fa0' },
  video: { bg: '#141414', fg: '#4fd0ff' },
  fuel: { bg: '#e2b62a', fg: '#c8281e' },
  bank: { bg: '#13306a', fg: '#ffffff' },
  momo: { bg: '#f2c200', fg: '#1a2440' },
  market: { bg: '#e86a1c', fg: '#ffffff' },
  salon: { bg: '#8a2a8a', fg: '#ffffff' },
  barber: { bg: '#1f4fa8', fg: '#ffffff' },
  materials: { bg: '#f2c200', fg: '#141414' },
  phones: { bg: '#ff7900', fg: '#ffffff' },
  provisions: { bg: '#2f8a4a', fg: '#ffffff' },
  tailor: { bg: '#6a3a8a', fg: '#ffffff' },
  boutique: { bg: '#e8b8c8', fg: '#5a1a3a' },
  parts: { bg: '#3a3a3a', fg: '#f2c200' },
}

/** A chunk's sign boards: their faces drawn on one picture (256 x 64 each), one mesh. */
function signMesh(signs: Sign[]): { mesh: Mesh; dispose: () => void } | null {
  if (signs.length === 0) return null
  const rows = Math.ceil(signs.length / 2)
  let height = 64
  while (height < rows * 64) height *= 2
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = height
  const g = canvas.getContext('2d')!
  const pos: number[] = []
  const uv: number[] = []
  signs.forEach((sg, i) => {
    const cx = (i % 2) * 256
    const cy = Math.floor(i / 2) * 64
    const style = SIGN_STYLE[sg.cat] ?? { bg: '#f4efe2', fg: '#1a1a1a' }
    g.fillStyle = style.bg
    g.fillRect(cx, cy, 256, 64)
    g.strokeStyle = 'rgba(0,0,0,0.35)'
    g.lineWidth = 4
    g.strokeRect(cx + 2, cy + 2, 252, 60)
    g.fillStyle = style.fg
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const text = (style.mark ? `${style.mark} ` : '') + sg.text.toUpperCase()
    // As big as fits; a long name on two lines.
    let size = 30
    g.font = `bold ${size}px sans-serif`
    while (g.measureText(text).width > 236 && size > 17) {
      size -= 1
      g.font = `bold ${size}px sans-serif`
    }
    if (g.measureText(text).width <= 236) g.fillText(text, cx + 128, cy + 33)
    else {
      const words = text.split(' ')
      const half = Math.ceil(words.length / 2)
      size = 22
      g.font = `bold ${size}px sans-serif`
      for (const [k, line] of [words.slice(0, half).join(' '), words.slice(half).join(' ')].entries()) {
        while (g.measureText(line).width > 240 && size > 12) {
          size -= 1
          g.font = `bold ${size}px sans-serif`
        }
        g.fillText(line, cx + 128, cy + 20 + k * 24)
      }
    }
    // The board: across the wall (its right toward the reader's right), facing out.
    const nx = Math.cos(sg.yaw)
    const ny = Math.sin(sg.yaw)
    const tx = -ny
    const ty = nx
    const c = (u: number, v: number) => [sg.x + tx * u, sg.z + v, -(sg.y + ty * u)]
    const a = c(-sg.w / 2, -sg.h / 2)
    const b = c(sg.w / 2, -sg.h / 2)
    const d = c(sg.w / 2, sg.h / 2)
    const e = c(-sg.w / 2, sg.h / 2)
    const u0 = cx / 512
    const u1 = (cx + 256) / 512
    const v0 = 1 - (cy + 64) / height
    const v1 = 1 - cy / height
    for (const [p, q] of [
      [a, [u0, v0]],
      [b, [u1, v0]],
      [d, [u1, v1]],
      [a, [u0, v0]],
      [d, [u1, v1]],
      [e, [u0, v1]],
    ] as [number[], number[]][]) {
      pos.push(p[0]!, p[1]!, p[2]!)
      uv.push(q[0]!, q[1]!)
    }
  })
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  const geo = new BufferGeometryClass()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  geo.computeVertexNormals()
  const mat = new MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new Color('#ffffff'), emissiveIntensity: 0, roughness: 0.7, side: DoubleSide })
  signMaterials.add(mat)
  const mesh = new Mesh(geo, mat)
  mesh.matrixAutoUpdate = false
  return {
    mesh,
    dispose: () => {
      signMaterials.delete(mat)
      geo.dispose()
      mat.dispose()
      tex.dispose()
    },
  }
}

/** The signalled junctions of the chunks built, by chunk (for the traffic to obey). */
export const signalsByChunk = new Map<string, Signal[]>()

/** The traffic lights' lamps lit by the town's one cycle (the game's real seconds). */
function Signals() {
  const mats = useMaterials()
  const lit: Record<string, string> = { r: '#ff2a1a', y: '#ffb000', g: '#20e050' }
  useFrame(() => {
    const state = signalState(Date.now() / 1000)
    for (const way of ['A', 'B'] as const)
      for (const c of ['r', 'y', 'g'] as const) mats[`sig${way}${c}` as `sig${SignalLamp}`].color.set(state[way] === c ? lit[c]! : '#2a2a28')
  })
  return null
}

/** Disposes a chunk's meshes (its places and solids are only data). */
function disposeParts(parts: ChunkParts) {
  for (const k of Object.keys(parts) as (keyof ChunkParts)[]) {
    const v = parts[k] as { dispose?: () => void } | null
    if (v && !Array.isArray(v)) v.dispose?.()
  }
  for (const g of Object.values(parts.signalLamps)) g?.dispose()
}

/** A town's real buildings, land and places, tile by tile (scripts/oal/makeCityData.py), where
 * there are tiles for it. */
const TILES: Record<string, string> = { Monrovia: '/oal/city/monrovia/t' }

function Chunks({ city, map, keep, player, solids, town }: { city: City; map: TownMapData; keep: Keep[]; player: RefObject<{ x: number; y: number }>; solids: RefObject<Map<string, Solid[]>>; town: string }) {
  const mats = useMaterials()
  const built = useRef(new Map<string, Built>())
  // The chunks are built in a worker (so the screen never waits for one); the one asked for.
  const worker = useMemo(() => {
    try {
      return new Worker(new URL('./chunk.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      return null
    }
  }, [])
  const pending = useRef<string | null>(null)
  // A worker that fails (it cannot start, it throws): the chunks built here instead.
  const broken = useRef(false)
  /** A chunk built: its meshes into the scene, its places, lamps, lights, walls registered. */
  const place = (cx: number, cy: number, parts: ChunkParts) => {
    const group = root.current
    const k = `${cx},${cy}`
    if (!group || built.current.has(k)) {
      disposeParts(parts)
      return
    }
    const g = new (group.constructor as new () => Group)()
    const add = (geo: BufferGeometry | null | undefined, mat: keyof Materials) => {
      if (!geo) return
      const m = new Mesh(geo, mats[mat])
      m.matrixAutoUpdate = false
      g.add(m)
    }
    add(parts.land, 'land')
    add(parts.dirt, 'dirt')
    add(parts.pavement, 'pavement')
    add(parts.asphalt, 'asphalt')
    add(parts.marks, 'marks')
    add(parts.walls, 'walls')
    add(parts.shops, 'shops')
    add(parts.roofs, 'roofs')
    add(parts.plain, 'plain')
    add(parts.leaves, 'leaves')
    add(parts.glow, 'glow')
    for (const s of SIGNAL_LAMPS) add(parts.signalLamps[s] ?? null, `sig${s}`)
    signalsByChunk.set(k, parts.signals)
    add(parts.pools, 'pools')
    lampsByChunk.set(k, parts.lamps)
    placesByChunk.set(k, parts.places)
    treesByChunk.set(k, parts.trees)
    treesVersion.n++
    const board = signMesh(parts.signs)
    if (board) g.add(board.mesh)
    group.add(g)
    built.current.set(k, { group: g, parts, dispose: board?.dispose })
    solids.current?.set(k, parts.solids)
  }
  const placeRef = useRef(place)
  placeRef.current = place
  useEffect(() => {
    if (!worker) return
    worker.postMessage({ type: 'map', map } satisfies ChunkRequest)
    worker.onmessage = (e: MessageEvent<{ type: 'built' | 'failed'; cx: number; cy: number; ms?: number; parts?: PackedParts }>) => {
      const { cx, cy } = e.data
      pending.current = null
      const at = player.current
      // Gone past it meanwhile: not wanted now.
      if (at && (Math.abs(cx - Math.floor(at.x / CHUNK)) > AROUND + 1 || Math.abs(cy - Math.floor(at.y / CHUNK)) > AROUND + 1)) return
      if (e.data.type === 'built' && e.data.parts) {
        cityStats.build = Math.max(cityStats.build, e.data.ms ?? 0)
        placeRef.current(cx, cy, unpackParts(e.data.parts))
      } else placeRef.current(cx, cy, buildChunk(city, cx, cy, keep, tiles.current.get(`${cx},${cy}`) ?? null))
    }
  }, [worker, map]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!worker) return
    worker.onerror = (e) => {
      console.error('[city] chunk worker failed, building here:', e.message)
      broken.current = true
      pending.current = null
    }
    return () => worker.terminate()
  }, [worker])
  // The tiles fetched (null: none there) and being fetched.
  const tiles = useRef(new Map<string, Tile | null>())
  const asked = useRef(new Set<string>())
  const root = useRef<Group>(null)
  useEffect(() => {
    const map = built.current
    return () => {
      for (const b of map.values()) {
        disposeParts(b.parts)
        b.dispose?.()
      }
      map.clear()
    }
  }, [])
  useFrame(() => {
    const group = root.current
    const at = player.current
    if (!group || !at) return
    const pcx = Math.floor(at.x / CHUNK)
    const pcy = Math.floor(at.y / CHUNK)
    // One new chunk a frame (the nearest missing), so walking never stutters.
    let want: [number, number] | null = null
    let best = Infinity
    for (let dx = -AROUND; dx <= AROUND; dx++)
      for (let dy = -AROUND; dy <= AROUND; dy++) {
        const k = `${pcx + dx},${pcy + dy}`
        if (built.current.has(k)) continue
        const d = dx * dx + dy * dy
        if (d < best) {
          best = d
          want = [pcx + dx, pcy + dy]
        }
      }
    // A town with tiles: its tile fetched first (the chunk built once it is here).
    const source = TILES[town]
    if (want && source) {
      const k = `${want[0]},${want[1]}`
      if (!tiles.current.has(k)) {
        if (!asked.current.has(k)) {
          asked.current.add(k)
          fetch(`${source}/${want[0]}_${want[1]}.v1.json`)
            .then((r) => (r.ok ? (r.json() as Promise<Tile>) : null))
            .catch(() => null)
            .then((t) => {
              tiles.current.set(k, t)
              asked.current.delete(k)
            })
        }
        // Meanwhile, the next nearest chunk whose tile is here.
        want = null
        let near = Infinity
        for (let dx = -AROUND; dx <= AROUND; dx++)
          for (let dy = -AROUND; dy <= AROUND; dy++) {
            const kk = `${pcx + dx},${pcy + dy}`
            if (built.current.has(kk)) continue
            if (!tiles.current.has(kk)) {
              if (!asked.current.has(kk)) {
                asked.current.add(kk)
                fetch(`${source}/${pcx + dx}_${pcy + dy}.v1.json`)
                  .then((r) => (r.ok ? (r.json() as Promise<Tile>) : null))
                  .catch(() => null)
                  .then((t) => {
                    tiles.current.set(kk, t)
                    asked.current.delete(kk)
                  })
              }
              continue
            }
            const d = dx * dx + dy * dy
            if (d < near) {
              near = d
              want = [pcx + dx, pcy + dy]
            }
          }
      }
    }
    if (want) {
      const [cx, cy] = want
      const tile = source ? (tiles.current.get(`${cx},${cy}`) ?? null) : null
      if (worker && !broken.current) {
        // One at a time: the next asked for once this one is back.
        if (pending.current === null) {
          pending.current = `${cx},${cy}`
          worker.postMessage({ type: 'build', cx, cy, keep, tile } satisfies ChunkRequest)
        }
      } else {
        const t0 = performance.now()
        const parts = buildChunk(city, cx, cy, keep, tile)
        cityStats.build = Math.max(cityStats.build, performance.now() - t0)
        place(cx, cy, parts)
      }
    }
    // Let go of what is far behind.
    for (const [k, b] of built.current) {
      const [cx, cy] = k.split(',').map(Number) as [number, number]
      if (Math.abs(cx - pcx) > AROUND + 1 || Math.abs(cy - pcy) > AROUND + 1) {
        group.remove(b.group)
        disposeParts(b.parts)
        b.dispose?.()
        placesByChunk.delete(k)
        lampsByChunk.delete(k)
        treesByChunk.delete(k)
        treesVersion.n++
        signalsByChunk.delete(k)
        built.current.delete(k)
        solids.current?.delete(k)
      }
    }
  })
  return <group ref={root} name="chunks" />
}

/** The ground under everything, to the horizon, following the player (its texture fixed to the town). */
function Ground({ player }: { player: RefObject<{ x: number; y: number }> }) {
  const mats = useMaterials()
  const mesh = useMemo(() => {
    const g = new PlaneGeometry(3000, 3000)
    g.rotateX(-Math.PI / 2)
    const m = new Mesh(g, mats.ground)
    return m
  }, [mats])
  useFrame(() => {
    const p = player.current
    if (!p) return
    // Moved in steps of the texture's own size, so it never slides.
    const sx = Math.round(p.x / 400) * 400
    const sy = Math.round(p.y / 400) * 400
    mesh.position.set(sx, 0, -sy)
    const map = mats.ground.map!
    map.repeat.set(3000 / 14, 3000 / 14)
  })
  return <primitive object={mesh} />
}

/** The sea, the lagoons and swamps: built once, the whole town's. */
function Water({ city }: { city: City }) {
  const mats = useMaterials()
  const meshes = useMemo(
    () =>
      (['wet', 'water', 'sea'] as const)
        .map((w) => {
          const g = waterGeometry(city, w)
          return g ? new Mesh(g, mats[w]) : null
        })
        .filter(Boolean) as Mesh[],
    [city, mats],
  )
  return (
    <>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  )
}

/** The sky: a dome, haze at the horizon (the fog's own colour) to blue overhead. */
// ---- Day and night ---------------------------------------------------------------------------

/** How light it is (1 by day, 0 at night) and how much of a dawn or a dusk is in the sky, at an
 * hour of the game's day (Monrovia: light from about 6:00, dark from about 19:00). */
export function daylight(hour: number) {
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  const day = smooth(5.6, 6.6, hour) * (1 - smooth(18.2, 19.1, hour))
  const glowAt = (h: number) => Math.max(0, 1 - Math.abs(hour - h) / 0.9)
  return { day, dusk: Math.max(glowAt(6.1), glowAt(18.6)) }
}

const SKY = {
  dayTop: new Color('#5f93cf'),
  dayHorizon: new Color('#c9d9e6'),
  nightTop: new Color('#070c1c'),
  nightHorizon: new Color('#18213a'),
  duskHorizon: new Color('#f0a060'),
  duskTop: new Color('#5a5a8a'),
}

/** The hour of the game's day (a test may set it). */
function hourNow(clock?: () => Date) {
  try {
    const forced = localStorage.getItem('oal-city-hour')
    if (forced) return Number(forced)
  } catch {
    // No storage: the game's clock.
  }
  const d = clock ? clock() : new Date()
  return d.getUTCHours() + d.getUTCMinutes() / 60
}

/** The sky, the sun, the haze and the lamps through the day: the street lamps on at dusk, off
 * at dawn; at night the nearest lamps light the street (the others their pools), windows lit. */
function DayNight({ clock, player }: { clock?: () => Date; player: RefObject<{ x: number; y: number }> }) {
  const { scene, camera } = useThree()
  const mats = useMaterials()
  const sun = useRef<DirectionalLight>(null)
  const sky = useRef<HemisphereLight>(null)
  const dome = useMemo(() => {
    const g = new SphereGeometry(900, 24, 12)
    g.setAttribute('color', new BufferAttribute(new Float32Array(g.attributes.position!.count * 3), 3))
    return new Mesh(g, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }))
  }, [])
  const lights = useMemo(() => Array.from({ length: 6 }, () => new PointLight('#ffd59a', 0, 24, 1.6)), [])
  const last = useRef({ at: -1, key: '' })
  const top = useMemo(() => new Color(), [])
  const horizon = useMemo(() => new Color(), [])
  useFrame(({ clock: t }) => {
    dome.position.copy(camera.position)
    if (t.elapsedTime - last.current.at < 0.4) return
    last.current.at = t.elapsedTime
    const { day, dusk } = daylight(hourNow(clock))
    const night = 1 - day
    cityNight.value = night
    // The sky's colours, and the haze the same as the horizon.
    top.copy(SKY.nightTop).lerp(SKY.dayTop, day).lerp(SKY.duskTop, dusk * 0.5)
    horizon.copy(SKY.nightHorizon).lerp(SKY.dayHorizon, day).lerp(SKY.duskHorizon, dusk * 0.7)
    const key = `${day.toFixed(2)}:${dusk.toFixed(2)}`
    if (key !== last.current.key) {
      last.current.key = key
      const pos = dome.geometry.attributes.position!
      const col = dome.geometry.attributes.color! as BufferAttribute
      const c = new Color()
      for (let i = 0; i < pos.count; i++) {
        c.copy(horizon).lerp(top, Math.pow(Math.max(0, pos.getY(i) / 900), 0.6))
        col.setXYZ(i, c.r, c.g, c.b)
      }
      col.needsUpdate = true
      if (scene.fog) (scene.fog as { color: Color }).color.copy(horizon)
      ;(scene.background as Color | null)?.copy?.(horizon)
      if (sun.current) {
        sun.current.intensity = 0.05 + 2.2 * day
        sun.current.color.set(dusk > 0.2 ? '#ffc890' : '#fff1dc')
      }
      if (sky.current) sky.current.intensity = 0.18 + 0.85 * day
      scene.environmentIntensity = 0.06 + 0.36 * day
      mats.walls.emissiveIntensity = night * 0.9
      mats.shops.emissiveIntensity = night * 0.8
      mats.glow.color.set(night > 0.4 ? '#ffe2a8' : '#b8b8b0')
      mats.pools.opacity = night * 0.32
      for (const m of signMaterials) m.emissiveIntensity = night * 0.55
      mats.pools.visible = night > 0.05
    }
    // The nearest working lamps really light the street.
    const p = player.current
    const near: number[][] = []
    if (p && night > 0.05) {
      for (const list of lampsByChunk.values()) for (const l of list) if (Math.abs(l[0]! - p.x) < 60 && Math.abs(l[1]! - p.y) < 60) near.push(l)
      near.sort((a, b) => Math.hypot(a[0]! - p.x, a[1]! - p.y) - Math.hypot(b[0]! - p.x, b[1]! - p.y))
    }
    lights.forEach((light, i) => {
      const l = near[i]
      light.intensity = l ? night * 40 : 0
      if (l) light.position.set(l[0]!, l[2]!, -l[1]!)
    })
  })
  return (
    <>
      <primitive object={dome} renderOrder={-1} />
      <hemisphereLight ref={sky} args={['#eaf2ff', '#7a5a3c', 1.0]} />
      <directionalLight ref={sun} position={[-60, 90, 40]} intensity={2.2} color="#fff1dc" />
      {lights.map((l, i) => (
        <primitive key={i} object={l} />
      ))}
    </>
  )
}

function Light() {
  const { gl, scene } = useThree()
  useMemo(() => {
    const pmrem = new PMREMGenerator(gl)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.4
    pmrem.dispose()
  }, [gl, scene])
  return null
}

// ---- Hubs and compounds -----------------------------------------------------------------------

/** A street built by hand, set into the town at its place (its own metres plus where it is). */
type Hub = { town: keyof typeof TOWNS; x: number; y: number }

/** Each hub's vehicles (in its own metres), for walking against. */
const hubTraffic = new Map<string, { current: Moving[] }>()

function HubStreet({ hub, player }: { hub: Hub; player: RefObject<{ x: number; y: number }> }) {
  const where = TOWNS[hub.town]
  const local = useRef({ x: 0, y: 0 })
  const moving = useMemo(() => {
    const m = { current: [] as Moving[] }
    hubTraffic.set(hub.town, m)
    return m
  }, [hub.town])
  useEffect(() => () => void hubTraffic.delete(hub.town), [hub.town])
  const gltf = useLoader(GLTFLoader, where.url, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const scene = useMemo(() => gltf.scene.clone(true), [gltf])
  useFrame(() => {
    const p = player.current
    if (p && local.current) {
      local.current.x = p.x - hub.x
      local.current.y = p.y - hub.y
    }
  })
  return (
    <group position={[hub.x, 0.005, -hub.y]} name={`hub-${hub.town}`}>
      <primitive object={scene} />
      {where.plan.lanes && where.plan.lanes.length > 0 && (
        <Suspense fallback={null}>
          <Traffic lanes={where.plan.lanes} reach={where.plan.reach + 30} player={local} moving={moving} spacing={35} />
        </Suspense>
      )}
    </group>
  )
}

/** A compound the game places: its wall round, its gate to the road, what stands inside. */
export type Compound = { name: string; x: number; y: number; yaw: number; w: number; d: number; building: { w: number; d: number; h: number; colour: string; roof: 'hip' | 'flat' }; wall: string }

/** The hubs within reach of the player (loaded as they come near: each is a download). */
function NearHubs({ hubs, player }: { hubs: Hub[]; player: RefObject<{ x: number; y: number }> }) {
  const [near, setNear] = useState<string[]>([])
  const last = useRef(0)
  useFrame(({ clock }) => {
    if (clock.elapsedTime - last.current < 1) return
    last.current = clock.elapsedTime
    const p = player.current
    if (!p) return
    const now = hubs.filter((h) => Math.hypot(p.x - h.x, p.y - h.y) < TOWNS[h.town].plan.reach + 500).map((h) => h.town)
    if (now.join() !== near.join()) setNear(now)
  })
  return (
    <>
      {hubs
        .filter((h) => near.includes(h.town))
        .map((h) => (
          <Suspense key={h.town} fallback={null}>
            <HubStreet hub={h} player={player} />
          </Suspense>
        ))}
    </>
  )
}

/** What the town has besides its streets (its traffic, its people, the hubs' streets, the
 * landmarks): if one cannot be fetched (a dropped connection), the town goes on without it. */
class Optional extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.warn('[city] left out:', error)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** What drawing the city costs (for tests, with localStorage 'oal-stats'): the slowest chunk
 * built (ms), the frame's triangles and draw calls, frames' average time over the last second. */
const cityStats = { build: 0, triangles: 0, calls: 0, frame: 0 }
function Stats() {
  const acc = useRef({ t: 0, n: 0 })
  const on = useMemo(() => {
    try {
      return !!localStorage.getItem('oal-stats')
    } catch {
      return false
    }
  }, [])
  useFrame(({ gl, scene }, dt) => {
    if (!on) return
    acc.current.t += dt
    acc.current.n++
    if (acc.current.t >= 1) {
      cityStats.frame = (acc.current.t / acc.current.n) * 1000
      acc.current = { t: 0, n: 0 }
    }
    cityStats.triangles = gl.info.render.triangles
    cityStats.calls = gl.info.render.calls
    if (acc.current.n === 0) {
      // Once a second: what is drawn, by whose it is (the nearest named group up), people apart.
      const by: Record<string, number> = {}
      scene.traverse((o) => {
        const m = o as Mesh
        if (!m.isMesh || !m.visible) return
        let up: Object3D | null = o
        let shown = true
        while (up) {
          if (!up.visible) shown = false
          up = up.parent
        }
        if (!shown) return
        let owner: Object3D | null = o.parent
        while (owner && !owner.name) owner = owner.parent
        const k = (o as SkinnedMesh).isSkinnedMesh ? 'people' : (owner?.name ?? 'other')
        by[k] = (by[k] ?? 0) + 1
      })
      ;(cityStats as unknown as { by: Record<string, number> }).by = by
      // And what the renderer works out each frame (all but subtrees left alone), by whose.
      const nodes: Record<string, number> = {}
      const walk = (o: Object3D, owner: string) => {
        const k = o.name && !o.name.startsWith('mixamorig') && o.parent === scene ? o.name : owner
        nodes[k] = (nodes[k] ?? 0) + 1
        for (const c of o.children) if (c.matrixWorldAutoUpdate) walk(c, o.parent === scene ? o.name || `${o.type}${scene.children.indexOf(o)}` : k)
      }
      walk(scene, 'scene')
      ;(cityStats as unknown as { nodes: Record<string, number> }).nodes = nodes
    }
    ;(window as unknown as { oalCityStats: typeof cityStats }).oalCityStats = cityStats
  })
  return null
}

/** The trees of the chunks built (each [kind, x, y, turn, size]); counted up as they change. */
const treesByChunk = new Map<string, number[][]>()
const treesVersion = { n: 0 }
const TREES_URL = '/oal/trees.v1.glb'
// Near: the trees as modelled; out to far, made light; past that, lost in the haze.
const TREE_NEAR = 60
const TREE_FAR = 230
const TREE_ROOM = { near: 160, far: 1400 }

/** The town's trees, every one of a kind drawn at once (an instanced mesh for each of its parts,
 * near and far), placed again as the player moves on. */
function Trees({ player }: { player: RefObject<{ x: number; y: number }> }) {
  const gltf = useLoader(GLTFLoader, TREES_URL, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const layers = useMemo(
    () =>
      TREE_KINDS.map((name) =>
        (['near', 'far'] as const).map((lod) => {
          const node = gltf.scene.getObjectByName(lod === 'near' ? name : `${name}_far`)
          const parts: InstancedMesh[] = []
          node?.updateMatrixWorld(true)
          const inv = node ? new Matrix4().copy(node.matrixWorld).invert() : new Matrix4()
          node?.traverse((o) => {
            const m = o as Mesh
            if (!m.isMesh) return
            const im = new InstancedMesh(m.geometry, m.material, TREE_ROOM[lod])
            im.count = 0
            im.frustumCulled = false
            // Its own place in the tree (the packed file's scale and shift kept).
            im.userData.local = new Matrix4().multiplyMatrices(inv, m.matrixWorld)
            parts.push(im)
          })
          return parts
        }),
      ),
    [gltf],
  )
  const last = useRef({ x: Infinity, y: Infinity, v: -1, t: 0 })
  const m4 = useMemo(() => new Matrix4(), [])
  const one = useMemo(() => new Matrix4(), [])
  const q = useMemo(() => new Quaternion(), [])
  const up = useMemo(() => new Vector3(0, 1, 0), [])
  const at = useMemo(() => new Vector3(), [])
  const size = useMemo(() => new Vector3(), [])
  useFrame(({ clock }) => {
    const p = player.current
    if (!p) return
    const l = last.current
    if (clock.elapsedTime - l.t < 0.25 || (l.v === treesVersion.n && Math.hypot(p.x - l.x, p.y - l.y) < 4)) return
    last.current = { x: p.x, y: p.y, v: treesVersion.n, t: clock.elapsedTime }
    const counts = layers.map(() => ({ near: 0, far: 0 }))
    for (const list of treesByChunk.values())
      for (const [kind, x, y, turn, s] of list as [number, number, number, number, number][]) {
        const d = Math.hypot(x - p.x, y - p.y)
        if (d > TREE_FAR) continue
        const lod = d < TREE_NEAR ? 'near' : 'far'
        const c = counts[kind]!
        if (c[lod] >= TREE_ROOM[lod]) continue
        m4.compose(at.set(x, 0, -y), q.setFromAxisAngle(up, turn), size.set(s, s, s))
        for (const im of layers[kind]![lod === 'near' ? 0 : 1]!) im.setMatrixAt(c[lod], one.multiplyMatrices(m4, im.userData.local as Matrix4))
        c[lod]++
      }
    layers.forEach((pair, kind) =>
      pair.forEach((parts, i) => {
        for (const im of parts) {
          im.count = counts[kind]![i === 0 ? 'near' : 'far']
          im.instanceMatrix.needsUpdate = true
        }
      }),
    )
  })
  return (
    <>
      {layers.flat(2).map((im, i) => (
        <primitive key={i} object={im} />
      ))}
    </>
  )
}

// ---- The insides of the town's businesses, in their own buildings -----------------------------

/** A business's inside set in its building: where it stands, how it is turned and sized. */
type Room = { key: string; kind: string; name: string; cat: string; mx: number; my: number; nx: number; ny: number; u0: number; u1: number; d: number; h: number; s: number; f0: number }
/** The insides near the player: their walls (to walk against), their places (the counter), their rooms. */
const insideSolids = new Map<string, Solid[]>()
const insidePlaces = new Map<string, CityPlace[]>()
const insideRooms = new Map<string, Room>()

/** A point of an inside (its own metres: x across, y from its front to its back) in the town. */
function roomPoint(r: Room, x: number, y: number): [number, number] {
  const ax = -r.ny
  const ay = r.nx
  const w = (y - r.f0) * r.s + 0.25
  return [r.mx + ax * x * r.s - r.nx * w, r.my + ay * x * r.s - r.ny * w]
}

/** Whether a point is in a room. */
function roomAtOf(r: Room, x: number, y: number) {
  const dx = x - r.mx
  const dy = y - r.my
  const u = dx * -r.ny + dy * r.nx
  const v = -(dx * r.nx + dy * r.ny)
  return v > 0 && v < r.d && u > r.u0 && u < r.u1
}

/** The room the point is in, if any (to keep the camera under its ceiling). */
function roomAt(x: number, y: number): Room | null {
  for (const r of insideRooms.values()) {
    const dx = x - r.mx
    const dy = y - r.my
    const u = dx * -r.ny + dy * r.nx
    const v = -(dx * r.nx + dy * r.ny)
    if (v > 0 && v < r.d && u > r.u0 && u < r.u1) return r
  }
  return null
}

/** The businesses near enough to see into: their insides set in their buildings (the nearest six). */
function NearInsides({ player }: { player: RefObject<{ x: number; y: number }> }) {
  const [near, setNear] = useState<Room[]>([])
  const last = useRef(0)
  useFrame(({ clock }) => {
    if (clock.elapsedTime - last.current < 0.6) return
    last.current = clock.elapsedTime
    const p = player.current
    if (!p) return
    const pcx = Math.floor(p.x / CHUNK)
    const pcy = Math.floor(p.y / CHUNK)
    const found: { r: Room; dist: number }[] = []
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const q of placesByChunk.get(`${pcx + dx},${pcy + dy}`) ?? []) {
          const kind = INSIDE_OF[q.cat]
          if (!q.room || !q.door || !q.face || !kind || !INSIDES[kind]) continue
          const dist = Math.hypot(q.room.x - p.x, q.room.y - p.y)
          if (dist > 40) continue
          const plan = INSIDES[kind]!
          const xs = plan.inside.flatMap((r) => [r[0]!, r[2]!])
          const ys = plan.inside.flatMap((r) => [r[1]!, r[3]!])
          const W = Math.max(...xs) - Math.min(...xs)
          const D = Math.max(...ys) - Math.min(...ys)
          const room = q.room
          const s = Math.max(0.8, Math.min(1, (2 * Math.min(-room.u0, room.u1) - 0.3) / W, (room.d - 0.4) / D, (room.h - 0.2) / (plan.ceiling ?? 3)))
          found.push({ r: { key: businessKey({ cat: q.cat, name: q.name, door: q.door, face: q.face }), kind, name: q.name, cat: q.cat, mx: room.x, my: room.y, nx: room.nx, ny: room.ny, u0: room.u0, u1: room.u1, d: room.d, h: room.h, s, f0: Math.min(...ys) }, dist })
        }
    found.sort((a, b) => a.dist - b.dist)
    const now = found.slice(0, 6).map((f) => f.r)
    if (now.map((r) => r.key).join('|') !== near.map((r) => r.key).join('|')) setNear(now)
  })
  return (
    <>
      {near.map((r) => (
        <Suspense key={r.key} fallback={null}>
          <InsideModel r={r} />
        </Suspense>
      ))}
    </>
  )
}

function InsideModel({ r }: { r: Room }) {
  const gltf = useLoader(GLTFLoader, INTERIORS_URL, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const crowd = useLoader(GLTFLoader, CROWD_URL('male'), (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const { gl } = useThree()
  const { root, light } = useMemo(() => {
    gl.localClippingEnabled = true
    const plan = INSIDES[r.kind]!
    const root = gltf.scene.getObjectByName(r.kind)!.clone(true)
    // Kept within its building's walls (a room smaller than the inside: cut, never through the walls).
    const ax = -r.ny
    const ay = r.nx
    const plane = (nx: number, ny: number, px: number, py: number) => new Plane(new Vector3(nx, 0, -ny), -(nx * px + ny * py))
    const planes = [
      plane(-r.nx, -r.ny, r.mx - r.nx * 0.05, r.my - r.ny * 0.05),
      plane(r.nx, r.ny, r.mx - r.nx * r.d, r.my - r.ny * r.d),
      plane(ax, ay, r.mx + ax * r.u0, r.my + ay * r.u0),
      plane(-ax, -ay, r.mx + ax * r.u1, r.my + ay * r.u1),
      new Plane(new Vector3(0, -1, 0), r.h - 0.05),
    ]
    root.traverse((o) => {
      if (OUTSIDE.test(o.name) || o.name.startsWith('sign')) {
        o.visible = false
        return
      }
      const m = o as Mesh
      if (!m.isMesh) return
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((mat) => {
        const c = mat.clone()
        c.clippingPlanes = planes
        return c
      })
      m.material = Array.isArray(m.material) ? mats : mats[0]!
    })
    const [ox, oy] = roomPoint(r, 0, 0)
    root.position.set(ox, 0.02, -oy)
    root.rotation.set(0, Math.atan2(r.nx, -r.ny), 0)
    root.scale.setScalar(r.s)
    // Its people at their work, standing (behind the counter, at the desk).
    ;(plan.attendants ?? []).forEach((a, i) => {
      const look = { ...defaultAppearance('male'), skin: [0.85, 0.7, 0.92][i % 3]!, outfit: ['shirt_jeans', 'tee_jeans'][i % 2]!, hair: ['short', 'lowcut'][i % 2]! }
      const p = person(crowd.scene, crowd.animations, look)
      ;(p.actions.idle ?? p.actions.walk)?.play()
      p.mixer.update(0.3 + i)
      const fig = stillFigure(p.root, `staff${i % 2}`)
      fig.position.set(a.x, 0, -a.y)
      fig.rotation.y = Math.atan2(a.face[0]!, -a.face[1]!)
      fig.scale.setScalar(1 / r.s)
      root.add(fig)
    })
    const [lx, ly] = roomPoint(r, 0, (r.f0 + (plan.inside[0]?.[3] ?? r.f0 + 6)) / 2)
    return { root, light: [lx, Math.min(r.h, (plan.ceiling ?? 3) * r.s) - 0.4, -ly] as [number, number, number] }
  }, [gltf, crowd, r, gl])
  // Its walls and its places (the counter...) for the walker, while it is here.
  useEffect(() => {
    const plan = INSIDES[r.kind]!
    // Its walls and fittings, cut to its building's room as it is drawn (a neighbour's doorway is
    // never in it); not its own front (the building's wall, with its opening, is its front).
    const ax = -r.ny
    const ay = r.nx
    const toRoom = (x: number, y: number) => {
      const [px, py] = roomPoint(r, x, y)
      return [(px - r.mx) * ax + (py - r.my) * ay, -((px - r.mx) * r.nx + (py - r.my) * r.ny)] as const
    }
    const fromRoom = (u: number, v: number): [number, number] => [r.mx + ax * u - r.nx * v, r.my + ay * u - r.ny * v]
    const solids: Solid[] = []
    for (const q of plan.solids) {
      if (Math.max(q[1]!, q[3]!) <= r.f0 + 0.45) continue
      const [ua, va] = toRoom(q[0]!, q[1]!)
      const [ub, vb] = toRoom(q[2]!, q[3]!)
      const u0 = Math.max(Math.min(ua, ub), r.u0)
      const u1 = Math.min(Math.max(ua, ub), r.u1)
      const v0 = Math.max(Math.min(va, vb), 0)
      const v1 = Math.min(Math.max(va, vb), r.d)
      if (u1 - u0 < 0.02 || v1 - v0 < 0.02) continue
      solids.push(solidOf([fromRoom(u0, v0), fromRoom(u1, v0), fromRoom(u1, v1), fromRoom(u0, v1)]))
    }
    insideSolids.set(r.key, solids)
    const places: CityPlace[] = []
    for (const [name, at] of Object.entries(plan.places)) {
      if (name === 'door' || name === 'bed') continue
      const [x, y] = roomPoint(r, at.x, at.y)
      if (roomAtOf(r, x, y) === false) continue
      const [fx, fy] = [-r.ny * at.face[0]! - r.nx * at.face[1]!, r.nx * at.face[0]! - r.ny * at.face[1]!]
      places.push({ name: `in:${r.key}`, x, y, face: [fx, fy] })
    }
    insidePlaces.set(r.key, places)
    insideRooms.set(r.key, r)
    return () => {
      insideSolids.delete(r.key)
      insidePlaces.delete(r.key)
      insideRooms.delete(r.key)
    }
  }, [r])
  return (
    <>
      <primitive object={root} />
      <pointLight position={light} intensity={8} distance={Math.max(8, r.d * 1.4)} decay={1.5} color="#ffe9c8" />
    </>
  )
}

// ---- The player's own car ------------------------------------------------------------------------

/** Whether a point is inside a solid (its box first). */
function inSolid(poly: Solid, x: number, y: number) {
  const bb = poly.bb
  if (bb && (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3])) return false
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as [number, number]
    const [xj, yj] = poly[j] as [number, number]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

/** The family's car, parked by the house's gate (on the verge before the compound's wall, along
 * the road), drawn where it is (driven or standing), its door shutting once it is left. */
function OwnCarModel({ c }: { c: Compound }) {
  const file = useLoader(GLTFLoader, CARS_URL, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const { camera } = useThree()
  const model = useMemo(() => {
    const m = buildCar(file.scene, 'suv', '#7a1a1a', null, () => 0.5)
    m.root.name = 'own-car'
    return m
  }, [file])
  useEffect(() => {
    const plan = CAR_PLANS.suv
    const [x, y] = compoundPoint(c, 5.5, -15.7)
    // (Facing the way the traffic goes on this side: its driver's door to the road.)
    if (!ownCar.d) ownCar.d = { legs: [], leg: 0, s: 0, x, y, yaw: c.yaw + Math.PI, v: 0, steer: 0, yawRate: 0, spin: 0, offset: 0, wantOffset: 0, len: plan.size[0]!, wide: Math.min(plan.size[2]!, 1.96), L: plan.wheelbase, r: Object.values(plan.wheels)[0]?.r ?? 0.34, top: 0, braking: false, slow: 0, held: 0, passing: 0 }
    ownCar.model = model
    return () => {
      ownCar.model = null
    }
  }, [model, c])
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1)
    const d = ownCar.d
    if (!d) return
    if (ownCar.phase === 'parked') for (const door of model.doors) door.t = Math.max(0, door.t - dt * 2)
    poseCar(model, d, 0.03, dt, { x: camera.position.x, z: camera.position.z }, cityNight.value)
  })
  return <primitive object={model.root} />
}

/** The game's places walked into at their doors (the rest are asked at: the gate, the ticket booth). */
const WALK_IN = new Set(['home', 'health', 'visa', 'jobs', 'phone', 'starline', 'citrus'])

/** The landmarks within sight (each its own file, loaded as one comes near it). */
function NearLandmarks({ player }: { player: RefObject<{ x: number; y: number }> }) {
  const [near, setNear] = useState<string[]>([])
  const last = useRef(0)
  useFrame(({ clock }) => {
    if (clock.elapsedTime - last.current < 1) return
    last.current = clock.elapsedTime
    const p = player.current
    if (!p) return
    const now = LANDMARKS.filter((l) => Math.hypot(p.x - l.x, p.y - l.y) < 550).map((l) => l.name)
    if (now.join() !== near.join()) setNear(now)
  })
  return (
    <>
      {LANDMARKS.filter((l) => near.includes(l.name)).map((l) => (
        <Suspense key={l.name} fallback={null}>
          <LandmarkModel l={l} />
        </Suspense>
      ))}
    </>
  )
}

function LandmarkModel({ l }: { l: Landmark }) {
  const gltf = useLoader(GLTFLoader, l.url, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const [x, y] = landmarkPoint(l, 0, 0)
  return <primitive object={gltf.scene} position={[x, 0.01, -y]} rotation={[0, l.yaw, 0]} />
}

// ---- The player -------------------------------------------------------------------------------

function pushOut(p: { x: number; y: number }, poly: number[][]) {
  // A circle out of a convex or concave polygon: by the nearest edge (through it if inside).
  let best = Infinity
  let cx = 0
  let cy = 0
  let within = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j] as [number, number]
    const [bx, by] = poly[i] as [number, number]
    if (ay > p.y !== by > p.y && p.x < ((bx - ax) * (p.y - ay)) / (by - ay) + ax) within = !within
    const dx = bx - ax
    const dy = by - ay
    const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / (dx * dx + dy * dy || 1)))
    const qx = ax + dx * t
    const qy = ay + dy * t
    const d = Math.hypot(p.x - qx, p.y - qy)
    if (d < best) {
      best = d
      cx = qx
      cy = qy
    }
  }
  if (!within && best >= RADIUS) return
  let nx = p.x - cx
  let ny = p.y - cy
  const len = Math.hypot(nx, ny) || 1
  nx /= len
  ny /= len
  if (within) {
    nx = -nx
    ny = -ny
  }
  p.x = cx + nx * RADIUS
  p.y = cy + ny * RADIUS
}

type Props = {
  town: string
  /** Where the player starts: a point (town metres) facing (yaw: forward is (sin, -cos)), or at
   * a place (out of its door, facing the street), or where a hub street is entered. */
  start: { x: number; y: number; f: number } | { place: string }
  appearance: Appearance
  stick: RefObject<Stick>
  look: RefObject<number | null>
  pitch?: RefObject<number>
  paused: boolean
  onPlace: (place: string | null) => void
  /** Kept but not shown (one is inside a place in the town): not drawn, not walked. */
  hidden?: boolean
  /** Walked in at a door (a business's doorway; the house's, the Ministry's, an office's): in, no button. */
  onWalkIn?: (place: string) => void
  onPosition?: (x: number, y: number, facing: number, moving: boolean) => void
  onReady?: (places: CityPlace[]) => void
  /** The street the player is on (its name on the map), as it changes. */
  onStreet?: (name: string | null) => void
  /** A ride waved down (shared with the page, which asks for it and pays). */
  ride?: RefObject<RideState>
  onRide?: (phase: RidePhase) => void
  /** Whether the player stands by a road a taxi or kekeh can stop on. */
  onRoadside?: (by: boolean) => void
  /** Where a ride can take one in this town (once the town is ready). */
  onDestinations?: (list: Destination[]) => void
  /** The game's time (its day and night). */
  clock?: () => Date
  /** The town is drawn round the player (the first streets built, the character there). */
  onDrawn?: () => void
  /** Where the GPS is taking the player: a beam of light over it, seen from afar. */
  target?: { x: number; y: number } | null
}

/** The GPS's mark: a tall beam of light over the place, seen over the roofs and through the haze. */
function Beam({ at }: { at: { x: number; y: number } }) {
  const mesh = useMemo(() => {
    const g = new CylinderGeometry(1.4, 1.4, 160, 12, 1, true)
    g.translate(0, 80, 0)
    return new Mesh(g, new MeshBasicMaterial({ color: '#ffd23a', transparent: true, opacity: 0.35, depthWrite: false, fog: false, side: DoubleSide }))
  }, [])
  useEffect(() => () => {
    mesh.geometry.dispose()
    ;(mesh.material as MeshBasicMaterial).dispose()
  }, [mesh])
  mesh.position.set(at.x, 0, -at.y)
  return <primitive object={mesh} />
}

function Walker({ props, city, start, compounds, hubs, places, solids, player }: { props: Props; city: City; start: { x: number; y: number; f: number }; compounds: Compound[]; hubs: Hub[]; places: CityPlace[]; solids: RefObject<Map<string, Solid[]>>; player: RefObject<{ x: number; y: number }> }) {
  const { appearance, stick, look, pitch, paused, onPlace, onPosition, onStreet } = props
  // How long since walking began here (a door just come out of is not walked straight back into).
  const walkedFor = useRef(0)
  const street = useRef<string | null | undefined>(undefined)
  const first = useRef(true)
  const roadside = useRef<boolean | undefined>(undefined)
  const seated = useRef(false)
  const told = useRef(false)
  const gltf = useLoader(GLTFLoader, CHARACTER_URL(appearance.sex), (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const { camera } = useThree()
  const keys = useRef(new Set<string>())
  const state = useRef({ x: start.x, y: start.y, facing: start.f, speed: 0, place: null as string | null, told: 0 })
  // Out of a door again (the town kept meanwhile): there, facing out, the camera behind.
  const begun = useRef(start)
  useEffect(() => {
    if (begun.current === start) return
    begun.current = start
    Object.assign(state.current, { x: start.x, y: start.y, facing: start.f, speed: 0 })
    if (player.current) player.current = { x: start.x, y: start.y }
    if (look) look.current = start.f
    first.current = true
    walkedFor.current = 0
  }, [start]) // eslint-disable-line react-hooks/exhaustive-deps
  const me = useMemo(() => {
    const p = person(gltf.scene, gltf.animations, appearance)
    p.actions.idle?.play()
    p.actions.walk?.play()
    if (p.actions.walk) p.actions.walk.weight = 0
    return p
  }, [gltf, appearance])
  useEffect(() => {
    if (look.current === null) (look as { current: number | null }).current = state.current.facing
  }, [look])
  useEffect(() => {
    const down = (e: KeyboardEvent) => keys.current.add(e.key.toLowerCase())
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase())
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])
  const target = useMemo(() => new Vector3(), [])
  const eye = useMemo(() => new Vector3(), [])
  const collide = (s: { x: number; y: number }) => {
    // The vehicles of the streets built by hand (in their own metres).
    for (const h of hubs) {
      const where = TOWNS[h.town]
      const lx = s.x - h.x
      const ly = s.y - h.y
      if (Math.hypot(lx, ly) > hubExtent(h.town) + 10) continue
      const local = { x: lx, y: ly }
      keepOutOf(local, hubTraffic.get(h.town)?.current ?? [], RADIUS)
      for (const poly of where.polys) {
        if (local.x < poly.minX || local.x > poly.maxX || local.y < poly.minY || local.y > poly.maxY) continue
        pushOut(local, poly.points)
      }
      s.x = local.x + h.x
      s.y = local.y + h.y
    }
    keepOutOf(s, cityMoving.current, RADIUS)
    const cx = Math.floor(s.x / CHUNK)
    const cy = Math.floor(s.y / CHUNK)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const poly of solids.current?.get(`${cx + dx},${cy + dy}`) ?? []) {
          const bb = poly.bb
          if (bb ? s.x < bb[0] - 1 || s.x > bb[2] + 1 || s.y < bb[1] - 1 || s.y > bb[3] + 1 : Math.abs(poly[0]![0]! - s.x) > 20 || Math.abs(poly[0]![1]! - s.y) > 20) continue
          pushOut(s, poly)
        }
    for (const c of compounds) for (const poly of compoundSolids(c)) pushOut(s, poly)
    for (const list of insideSolids.values()) for (const poly of list) pushOut(s, poly)
  }
  /** Whether a car there would be in something (a building, a wall, another vehicle). */
  const carHits = (x: number, y: number, yaw: number, len: number, wide: number) => {
    const pts = outline(x, y, yaw, len - 0.1, wide - 0.1)
    const cx = Math.floor(x / CHUNK)
    const cy = Math.floor(y / CHUNK)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const poly of solids.current?.get(`${cx + dx},${cy + dy}`) ?? []) {
          const bb = poly.bb
          if (bb && (x < bb[0] - 6 || x > bb[2] + 6 || y < bb[1] - 6 || y > bb[3] + 6)) continue
          if (pts.some(([px, py]) => inSolid(poly, px, py))) return true
        }
    for (const c of compounds) if (Math.hypot(c.x - x, c.y - y) < 40) for (const poly of compoundSolids(c)) if (pts.some(([px, py]) => inSolid(poly, px, py))) return true
    const box = { x, y, yaw, hl: len / 2, hw: wide / 2 }
    return cityMoving.current.some((m) => overlaps(box, m, 0.05))
  }
  const seatOwn = useRef(false)
  /** The player's own car, a frame of it (true while in it: getting in, driving, getting out). */
  const ownDriving = (dt: number) => {
    const oc = ownCar
    const d = oc.d
    const car = oc.model
    const req = oc.request
    oc.request = null
    if (!d || !car) return false
    const s = state.current
    const say = (phase: OwnCarPhase) => {
      oc.phase = phase
      oc.t = 0
      oc.onPhase?.(phase)
    }
    if (req === 'in' && oc.phase === 'parked') say('entering')
    if (req === 'out' && oc.phase === 'driving' && Math.abs(d.v) < 1.2) say('leaving')
    if (req === 'view') oc.view = oc.view === 'outside' ? 'inside' : 'outside'
    if (oc.phase === 'parked') return false
    oc.t += dt
    const plan = CAR_PLANS[car.model]
    const door = car.doors.find((q) => q.side === 'left' && q.front)
    const c = Math.cos(d.yaw)
    const sn = Math.sin(d.yaw)
    // A point of the car (x ahead, z to its right) on the map.
    const at = (ax: number, az: number): [number, number] => [d.x + c * ax + sn * az, d.y + sn * ax - c * az]
    const doorAt = plan.doors.find((q) => q.side === 'left' && q.front)
    const [hx, , hz] = (doorAt as unknown as { at?: number[] })?.at ?? [0.9, 0, -0.8]
    if (oc.phase === 'entering') {
      // The door swung open, in, the door shut behind.
      if (door) door.t = oc.t < 0.5 ? oc.t / 0.5 : oc.t < 1.0 ? 1 : Math.max(0, 1 - (oc.t - 1.0) / 0.5)
      if (oc.t > 1.5) say('driving')
    }
    if (oc.phase === 'leaving') {
      if (door) door.t = oc.t < 0.5 ? oc.t / 0.5 : oc.t < 1.0 ? 1 : Math.max(0, 1 - (oc.t - 1.0) / 0.5)
      if (oc.t > 0.6) {
        // Out beside the driver's door, facing along the car.
        const [ox, oy] = at(hx! - 0.45, hz! - 0.9)
        s.x = ox
        s.y = oy
        s.facing = Math.atan2(c, -sn)
        seatOwn.current = false
        me.root.visible = true
        me.actions.sit?.stop()
        if (look) look.current = s.facing
        first.current = true
        say('parked')
        return false
      }
    }
    if (oc.phase === 'driving') {
      const k = keys.current
      let x = stick.current?.x ?? 0
      let y = stick.current?.y ?? 0
      if (k.has('arrowup') || k.has('w')) y = 1
      if (k.has('arrowdown') || k.has('s')) y = -1
      if (k.has('arrowleft') || k.has('a')) x = -1
      if (k.has('arrowright') || k.has('d')) x = 1
      const step = driveOwn(d, dt, paused ? 0 : y, paused ? 0 : x)
      const nx = d.x + Math.cos(step.yaw) * step.dist
      const ny = d.y + Math.sin(step.yaw) * step.dist
      // Never through anything: what it meets stops it (a little bounce back).
      if (carHits(nx, ny, step.yaw, d.len, d.wide)) d.v = -d.v * 0.2
      else {
        d.x = nx
        d.y = ny
        d.yaw = Math.atan2(Math.sin(step.yaw), Math.cos(step.yaw))
        d.spin += step.dist / d.r
      }
    }
    // The player at the wheel (seen sitting there from outside; from the seat, the town ahead).
    if (oc.phase !== 'leaving' && oc.t > (oc.phase === 'entering' ? 0.5 : 0)) {
      if (!seatOwn.current) {
        seatOwn.current = true
        me.actions.walk && (me.actions.walk.weight = 0)
        me.actions.idle && (me.actions.idle.weight = 0)
        me.actions.sit?.reset().play()
      }
      const [dx, dy, dz] = plan.driver
      const [px, py] = at(dx! - 0.1, dz!)
      me.root.position.set(px, 0.03 + dy! - 0.42, -py)
      me.root.rotation.y = d.yaw + Math.PI / 2
      me.mixer.update(dt)
    }
    me.root.visible = !(oc.phase === 'driving' && oc.view === 'inside')
    s.x = d.x
    s.y = d.y
    if (player.current) {
      player.current.x = d.x
      player.current.y = d.y
    }
    if (oc.phase === 'driving' && oc.view === 'inside') {
      // From the driver's seat: the head's height, looking down the road ahead.
      const [dx, dy, dz] = plan.driver
      const [ex, ey] = at(dx! - 0.05, dz!)
      const [tx, ty] = at(dx! + 20, dz! * 0.4)
      eye.set(ex, 0.03 + dy! + 0.78, -ey)
      target.set(tx, 0.03 + dy! + 0.5, -ty)
      camera.position.copy(eye)
    } else {
      // From behind it, following it round.
      target.set(d.x + c * 2, 1.1, -(d.y + sn * 2))
      eye.set(d.x - c * 6.8, 2.7, -(d.y - sn * 6.8))
      if (first.current) {
        first.current = false
        camera.position.copy(eye)
      } else camera.position.lerp(eye, Math.min(1, dt * 4))
    }
    camera.lookAt(target)
    return true
  }
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.25)
    const s = state.current
    // Ready once the street under the player is built.
    if (!told.current && solids.current?.has(`${Math.floor(s.x / CHUNK)},${Math.floor(s.y / CHUNK)}`)) {
      told.current = true
      props.onDrawn?.()
    }
    const r = props.ride?.current
    // In the vehicle: seated in the back, the town going by; the camera behind the vehicle.
    if (r && (r.phase === 'riding' || r.phase === 'arrived')) {
      const [sx, sy, sz] = PASSENGER[r.kind]
      const c = Math.cos(r.pos.yaw)
      const sn = Math.sin(r.pos.yaw)
      // Ahead (c, sn) and to the right (sn, -c) on the map.
      const px = r.pos.x + c * sx + sn * sz
      const py = r.pos.y + sn * sx - c * sz
      if (!seated.current) {
        seated.current = true
        me.actions.walk && (me.actions.walk.weight = 0)
        me.actions.idle && (me.actions.idle.weight = 0)
        me.actions.wave?.stop()
        me.actions.sit?.reset().play()
      }
      me.root.position.set(px, 0.08 + sy, -py)
      me.root.rotation.y = r.pos.yaw + Math.PI / 2
      me.mixer.update(dt)
      s.x = r.pos.x
      s.y = r.pos.y
      if (player.current) {
        player.current.x = s.x
        player.current.y = s.y
      }
      target.set(r.pos.x, 1.3, -r.pos.y)
      eye.set(r.pos.x - c * 7.5, 3.4, -(r.pos.y - sn * 7.5))
      camera.position.lerp(eye, Math.min(1, dt * 3))
      camera.lookAt(target)
      return
    }
    // The player's own car: got into, driven, got out of.
    if (ownDriving(dt)) return
    if (seated.current) {
      // Out on the kerb, standing again.
      seated.current = false
      me.actions.sit?.stop()
      if (r?.exit) {
        s.x = r.exit.x
        s.y = r.exit.y
        s.facing = r.exit.f
        r.exit = null
      }
    }
    // Waving down the ride as it comes.
    const waving = r?.phase === 'coming' && me.actions.wave
    if (waving && !me.actions.wave!.isRunning()) me.actions.wave!.reset().play()
    if (!waving && me.actions.wave?.isRunning()) me.actions.wave.stop()
    const k = keys.current
    let x = stick.current?.x ?? 0
    let y = stick.current?.y ?? 0
    if (k.has('arrowup') || k.has('w')) y = 1
    if (k.has('arrowdown') || k.has('s')) y = -1
    if (k.has('arrowleft') || k.has('a')) x = -1
    if (k.has('arrowright') || k.has('d')) x = 1
    const yaw = look.current ?? start.f
    let dx = 0
    let dy = 0
    if (!paused) {
      dx = Math.sin(yaw) * y - Math.cos(yaw) * x
      dy = -Math.cos(yaw) * y - Math.sin(yaw) * x
    }
    const amount = Math.min(1, Math.hypot(dx, dy))
    if (amount > 0.05) {
      const n = Math.hypot(dx, dy)
      const distance = amount * WALK_SPEED * dt
      const steps = Math.ceil(distance / 0.08)
      for (let i = 0; i < steps; i++) {
        s.x += ((dx / n) * distance) / steps
        s.y += ((dy / n) * distance) / steps
        collide(s)
      }
      let turn = Math.atan2(dx, -dy) - s.facing
      turn = Math.atan2(Math.sin(turn), Math.cos(turn))
      s.facing += turn * Math.min(1, dt * 10)
    }
    s.speed += (amount - s.speed) * Math.min(1, dt * 8)
    const ground = groundHeight(city, s.x, s.y)
    me.root.position.set(s.x, 0.05 + ground, -s.y)
    me.root.rotation.y = s.facing
    if (player.current) {
      player.current.x = s.x
      player.current.y = s.y
    }
    if (me.actions.walk && me.actions.idle) {
      const w = waving ? 0 : 1
      me.actions.walk.weight = s.speed * w
      me.actions.idle.weight = (1 - s.speed) * w
      me.actions.walk.timeScale = 0.6 + s.speed * 0.5
    }
    me.mixer.update(dt)
    s.told += dt
    if (s.told > 0.25) {
      s.told = 0
      onPosition?.(s.x, s.y, s.facing, s.speed > 0.2)
      // Inside a business: its name; else the road's.
      const name = roomAt(s.x, s.y)?.name ?? namedRoad(city, s.x, s.y)
      // By a road a vehicle can pull in on (within a few metres of its edge).
      const road = nearestRoad(city, s.x, s.y, 30)
      const by = Boolean(road && road.d < road.seg.w / 2 + 6)
      if (by !== roadside.current) {
        roadside.current = by
        props.onRoadside?.(by)
      }
      if (name !== street.current) {
        street.current = name
        onStreet?.(name)
      }
    }
    let near: string | null = null
    for (const p of places) if (Math.hypot(s.x - p.x, s.y - p.y) < NEAR) near = p.name
    // By the driver's door of the player's own car.
    if (ownCar.phase === 'parked' && ownCar.d && ownCar.model) {
      const d = ownCar.d
      const plan = CAR_PLANS[ownCar.model.model]
      const [hx, , hz] = (plan.doors.find((q) => q.side === 'left' && q.front) as unknown as { at?: number[] })?.at ?? [0.9, 0, -0.8]
      const c = Math.cos(d.yaw)
      const sn = Math.sin(d.yaw)
      const dxp = d.x + c * (hx! - 0.45) + sn * (hz! - 0.7)
      const dyp = d.y + sn * (hx! - 0.45) - c * (hz! - 0.7)
      if (Math.hypot(s.x - dxp, s.y - dyp) < 1.6) near = 'own-car'
    }
    // At a business's counter, inside it.
    for (const list of insidePlaces.values()) for (const p of list) if (Math.hypot(s.x - p.x, s.y - p.y) < 2.8) near = p.name
    // A business's door (the town's places: "biz:" its category and name).
    if (!near) {
      const ck = `${Math.floor(s.x / CHUNK)},${Math.floor(s.y / CHUNK)}`
      for (const p of placesByChunk.get(ck) ?? []) if (p.door && p.face && Math.hypot(s.x - p.door[0], s.y - p.door[1]) < 2.2) near = businessKey({ cat: p.cat, name: p.name, door: p.door, face: p.face })
    }
    if (near !== s.place) {
      s.place = near
      onPlace(near)
    }
    // Walked in at a door: into its doorway (a business), onto its step (the house, the Ministry's
    // hall, an office, the shops on Tubman Boulevard). Not while just come out of it.
    walkedFor.current += dt
    if (props.onWalkIn && walkedFor.current > 1.2 && s.speed > 0.2 && near) {
      let at: number[] | null = null
      if (near.startsWith('biz:')) {
        const ck = `${Math.floor(s.x / CHUNK)},${Math.floor(s.y / CHUNK)}`
        const p = (placesByChunk.get(ck) ?? []).find((q) => q.door && q.face && businessKey({ cat: q.cat, name: q.name, door: q.door, face: q.face }) === near)
        if (p && INSIDE_OF[p.cat] && !p.room) at = [p.door![0] + p.face![0] * 1.4, p.door![1] + p.face![1] * 1.4]
      } else if (WALK_IN.has(near)) {
        const p = places.find((q) => q.name === near)
        if (p) at = [p.x, p.y]
      }
      if (at && Math.hypot(s.x - at[0]!, s.y - at[1]!) < (near.startsWith('biz:') ? 0.95 : 0.7)) {
        walkedFor.current = -1e9
        props.onWalkIn(near)
      }
    }
    // As in a game: the camera goes round the character at a fixed distance (turned by a drag
    // sideways, raised or lowered by a drag up or down), always looking at the character; it
    // never comes in close.
    // Indoors (in a business's room): nearer, and under its ceiling.
    const room = roomAt(s.x, s.y)
    const tilt = pitch?.current ?? 0
    const roomTop = room ? Math.min(room.h, 3 * room.s) - 0.35 : Infinity
    const elev = Math.max(-0.12, Math.min(room ? Math.asin(Math.max(-0.1, Math.min(0.9, (roomTop - 1.45) / 2.5))) : 1.15, 0.3 - tilt * 0.75))
    const back = room ? 2.5 : paused ? 3.4 : 4.6
    const flat = Math.cos(elev) * back
    target.set(s.x, ground + 1.45 + Math.max(0, -elev) * 2 + Math.max(0, tilt - 0.6) * 1.5, -s.y)
    eye.set(s.x - Math.sin(yaw) * flat, ground + Math.max(0.35, 1.45 + Math.sin(elev) * back), -(s.y + Math.cos(yaw) * flat))
    // Never inside a wall: pulled in to the first solid between the character and the camera.
    let pull = 1
    const ex = eye.x
    const ey = -eye.z
    const ccx = Math.floor(s.x / CHUNK)
    const ccy = Math.floor(s.y / CHUNK)
    for (let ddx = -1; ddx <= 1; ddx++)
      for (let ddy = -1; ddy <= 1; ddy++)
        for (const poly of solids.current?.get(`${ccx + ddx},${ccy + ddy}`) ?? []) {
          const bb = poly.bb
          if (bb ? Math.max(s.x, ex) < bb[0] || Math.min(s.x, ex) > bb[2] || Math.max(s.y, ey) < bb[1] || Math.min(s.y, ey) > bb[3] : Math.abs(poly[0]![0]! - s.x) > 16 || Math.abs(poly[0]![1]! - s.y) > 16) continue
          pull = Math.min(pull, segmentHit(s.x, s.y, ex, ey, poly))
        }
    for (const c of compounds) if (Math.hypot(c.x - s.x, c.y - s.y) < 40) for (const poly of compoundSolids(c)) pull = Math.min(pull, segmentHit(s.x, s.y, ex, ey, poly))
    for (const list of insideSolids.values()) for (const poly of list) pull = Math.min(pull, segmentHit(s.x, s.y, ex, ey, poly))
    if (pull < 1) {
      // A wall between: in front of it if that is not too close; else up over the character's
      // head, looking down on them (never in on them).
      const t = Math.max(pull - 0.08, room ? 0.12 : 0)
      if (t * back >= 2.2 || room) {
        eye.x = s.x + (ex - s.x) * t
        eye.z = -(s.y + (ey - s.y) * t)
      } else {
        const high = Math.max(elev, 1.0)
        const f2 = Math.cos(high) * 2.6
        eye.set(s.x - Math.sin(yaw) * f2, 1.45 + Math.sin(high) * 4.4, -(s.y + Math.cos(yaw) * f2))
      }
    }
    // First seen: there at once (not flying in from the town's centre).
    if (first.current) {
      first.current = false
      camera.position.copy(eye)
    } else camera.position.lerp(eye, Math.min(1, dt * 5))
    camera.lookAt(target)
  })
  return <primitive object={me.root} />
}

/** How far along a segment (0..1) it first crosses a polygon's edge (1: not at all). */
function segmentHit(ax: number, ay: number, bx: number, by: number, poly: number[][]) {
  let best = 1
  const rx = bx - ax
  const ry = by - ay
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [cx, cy] = poly[j] as [number, number]
    const [dx, dy] = poly[i] as [number, number]
    const sx = dx - cx
    const sy = dy - cy
    const den = rx * sy - ry * sx
    if (Math.abs(den) < 1e-9) continue
    const t = ((cx - ax) * sy - (cy - ay) * sx) / den
    const u = ((cx - ax) * ry - (cy - ay) * rx) / den
    if (t > 0 && t < best && u >= 0 && u <= 1) best = t
  }
  return best
}

/** The name of the nearest named road (within 150 m), for the chip. */
function namedRoad(city: City, x: number, y: number): string | null {
  let best: { d: number; name: string } | null = null
  for (const id of segsNear(city, x, y, 150)) {
    const sg = city.segs[id]!
    if (!sg.name) continue
    // Measured from the road's edge, so a wide road one stands on wins over a lane near by.
    const d = toSeg(sg, x, y).d - sg.w / 2
    if (d < 150 && (!best || d < best.d)) best = { d, name: sg.name }
  }
  return best?.name ?? null
}

/** The town's own traffic (town metres). */
const cityMoving: { current: Moving[] } = { current: [] }

/** A point of a compound's model (x across, y from its gate at the front to its back) in the town. */
function compoundPoint(c: Compound, u: number, v: number): [number, number] {
  const cs = Math.cos(c.yaw)
  const sn = Math.sin(c.yaw)
  const w = v - COMPOUNDS_BUILT[c.name as keyof typeof COMPOUNDS_BUILT].cy
  return [c.x + cs * u - sn * w, c.y + sn * u + cs * w]
}

/** A compound's walls, its house's or its building's, its yard's things (its plan's), as solids;
 * the Ministry's gate while it is shut. */
const builtSolids = new Map<string, Solid[]>()
function compoundSolids(c: Compound): Solid[] {
  const built = COMPOUNDS_BUILT[c.name as keyof typeof COMPOUNDS_BUILT]
  const rect = (r: number[]) => solidOf([compoundPoint(c, r[0]!, r[1]!), compoundPoint(c, r[2]!, r[1]!), compoundPoint(c, r[2]!, r[3]!), compoundPoint(c, r[0]!, r[3]!)])
  const k = `${c.name}:${c.x}:${c.y}`
  let walls = builtSolids.get(k)
  if (!walls) builtSolids.set(k, (walls = built.plan.solids.map(rect)))
  const gate = 'gate' in built.plan ? built.plan.gate : undefined
  return gate && c.name === 'health' && !gates.health ? [...walls, rect(gate.solid)] : walls
}

/** A compound as it is built (the house on its plot, the Ministry in its compound: the same model
 * as their insides, without the street each once had of its own), its gate's leaf sliding open
 * when the guards let one in, the guards at the gate. */
function CompoundModel({ c }: { c: Compound }) {
  const built = COMPOUNDS_BUILT[c.name as keyof typeof COMPOUNDS_BUILT]
  const gltf = useLoader(GLTFLoader, HOME_URL, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const crowd = useLoader(GLTFLoader, CROWD_URL('male'), (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const { root, gate, guards } = useMemo(() => {
    const root = gltf.scene.getObjectByName(built.kind)!.clone(true)
    root.traverse((o) => {
      if (OUTSIDE.test(o.name)) o.visible = false
    })
    const [x, y] = compoundPoint(c, 0, 0)
    root.position.set(x, 0, -y)
    root.rotation.set(0, c.yaw, 0)
    const plan = built.plan
    const leaf = 'gate' in plan && plan.gate ? root.getObjectByName(plan.gate.name) : undefined
    // The police at the Ministry's gate, in navy, standing.
    const guards = ('guards' in plan ? (plan.guards ?? []) : []).map((g, i) => {
      const base = defaultAppearance('male')
      const p = person(crowd.scene, crowd.animations, { ...base, skin: [0.8, 0.65][i % 2]!, outfit: 'suit', hair: 'lowcut' }, '#1f2f5a')
      ;(p.actions.idle ?? p.actions.walk)?.play()
      p.mixer.update(0.3)
      const fig = stillFigure(p.root, 'guard')
      fig.position.set(g.x, 0.02, -g.y)
      fig.rotation.y = Math.atan2(g.face[0]!, -g.face[1]!)
      root.add(fig)
      return fig
    })
    return { root, gate: leaf ? { obj: leaf, x: leaf.position.x, open: 0 } : null, guards }
  }, [gltf, crowd, c, built])
  useFrame((_, raw) => {
    if (!gate || !('gate' in built.plan) || !built.plan.gate) return
    const want = c.name === 'health' && gates.health ? 1 : 0
    gate.open += (want - gate.open) * Math.min(1, Math.min(raw, 0.1) * 1.5)
    gate.obj.position.x = gate.x + built.plan.gate.slide * gate.open
  })
  void guards
  return <primitive object={root} />
}

// ---- The game's own offices and the parking station ------------------------------------------------

/** The visa office, the job centre (an office building each, its name over the door) and the
 * parking station (a lot of parked buses, taxis and kekehs, its shelter and ticket booth), where
 * they are on the town's map, each facing its road. */
type Site = { name: 'visa' | 'jobs' | 'station'; title: string; x: number; y: number; yaw: number; w: number; d: number }
const SITE_SIZE: Record<Site['name'], [number, number]> = { visa: [16, 12], jobs: [16, 12], station: [40, 28] }
const SITE_TITLE: Record<Site['name'], string> = { visa: 'VISA OFFICE', jobs: 'JOB CENTRE', station: 'RED LIGHT PARKING STATION' }

function sitesOf(town: string, map: TownMap, city: City): Site[] {
  if (town !== 'Monrovia') return []
  const out: Site[] = []
  for (const name of ['visa', 'jobs', 'station'] as const) {
    const at = map.places[name]
    if (!at) continue
    const [w, d] = SITE_SIZE[name]
    const c = compoundAt(city, name, at.x, at.y, w, d, { w, d, h: 6, colour: '#e9e0c6', roof: 'flat' })
    out.push({ name, title: SITE_TITLE[name], x: c.x, y: c.y, yaw: c.yaw, w, d })
  }
  return out
}

/** A point of a site (u across, v from its front, -v, to its back) in the town. */
function sitePoint(s: { x: number; y: number; yaw: number }, u: number, v: number): [number, number] {
  const cs = Math.cos(s.yaw)
  const sn = Math.sin(s.yaw)
  return [s.x + cs * u - sn * v, s.y + sn * u + cs * v]
}

/** Where one goes in (the office's door; the station's ticket booth), facing in. */
function siteDoor(s: Site): { x: number; y: number; face: number[] } {
  const [x, y] = s.name === 'station' ? sitePoint(s, s.w / 2 - 6, -s.d / 2 + 4.2) : sitePoint(s, 0, -s.d / 2 - 1.0)
  return { x, y, face: [-Math.sin(s.yaw), Math.cos(s.yaw)] }
}

function siteSolids(s: Site): Solid[] {
  const rect = (u0: number, v0: number, u1: number, v1: number) => solidOf([sitePoint(s, u0, v0), sitePoint(s, u1, v0), sitePoint(s, u1, v1), sitePoint(s, u0, v1)])
  if (s.name !== 'station') return [rect(-s.w / 2, -s.d / 2, s.w / 2, s.d / 2)]
  // The ticket booth; the parked vehicles' rows.
  return [rect(s.w / 2 - 7.5, -s.d / 2 + 4.5, s.w / 2 - 4.5, -s.d / 2 + 7), rect(-s.w / 2 + 2, 2, s.w / 2 - 2, 12)]
}

function SiteModel({ s }: { s: Site }) {
  const mats = useMaterials()
  const vehicles = useLoader(GLTFLoader, VEHICLES_URL, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const { group, boards } = useMemo(() => {
    const group = new ThreeGroup()
    const [ox, oy] = sitePoint(s, 0, 0)
    group.position.set(ox, 0, -oy)
    group.rotation.y = s.yaw
    // In the group: x across (u), y up, z = -v (the front, -v, toward +z).
    const box = (u: number, v: number, w: number, d: number, z: number, h: number, colour: string, mat: MeshStandardMaterial = mats.plain) => {
      const m = new Mesh(new BoxGeometry(w, h, d), mat.clone())
      const mm = m.material as MeshStandardMaterial
      mm.vertexColors = false
      mm.map = null
      mm.color = new Color(colour)
      m.position.set(u, z + h / 2, -v)
      group.add(m)
      return m
    }
    const signs: Sign[] = []
    // A sign board facing the front, at (u, v), its middle z high.
    const board = (text: string, u: number, v: number, z: number, w: number, h: number, cat: string) => {
      const [x, y] = sitePoint(s, u, v)
      signs.push({ text, cat, x, y, z, yaw: Math.atan2(-Math.cos(s.yaw), Math.sin(s.yaw)), w, h })
    }
    if (s.name !== 'station') {
      const W = s.w
      const D = s.d
      box(0, 0, W, D, 0, 6.6, '#e9e0c6')
      box(0, 0, W + 0.4, D + 0.4, 6.6, 0.7, '#d8ccb0')
      box(0, -D / 2 - 0.05, W + 0.1, 0.12, 3.2, 0.25, '#b8ac90')
      // The windows, two floors; the door in the middle, glass, and its steps.
      for (const z of [1.0, 4.2])
        for (let i = 0; i < 6; i++) {
          const u = -W / 2 + 1.6 + i * ((W - 3.2) / 5)
          if (z < 2 && Math.abs(u) < 2) continue
          box(u, -D / 2 - 0.04, 1.5, 0.1, z, 1.5, '#2a3a44')
        }
      box(0, -D / 2 - 0.05, 2.2, 0.12, 0, 2.5, '#1a2a30')
      box(0, -D / 2 - 0.9, 3.6, 1.6, 0, 0.16, '#bdb6a8')
      box(0, -D / 2 - 0.9, 3.6, 0.1, 2.6, 0.12, '#8a8478')
      board(s.title, 0, -D / 2 - 0.12, 3.05, Math.min(W - 2, 9), 0.85, 'government')
    } else {
      const W = s.w
      const D = s.d
      // The lot, worn bare; the shelter of zinc on its posts; the ticket booth by the road.
      const lot = new Mesh(new PlaneGeometry(W, D), new MeshStandardMaterial({ color: '#9a6a44', roughness: 1 }))
      lot.rotation.x = -Math.PI / 2
      lot.position.set(0, 0.02, 0)
      group.add(lot)
      for (let i = 0; i < 6; i++) for (const v of [-4, 2]) box(-W / 2 + 4 + i * ((W - 8) / 5), v, 0.12, 0.12, 0, 3.2, '#5a5a58')
      box(0, -1, W - 6, 7.5, 3.2, 0.08, '#9a9a96', mats.roofs)
      for (let i = 0; i < 4; i++) box(-W / 2 + 6 + i * 3.2, -2, 2.6, 0.5, 0, 0.45, '#6b4a2e')
      box(W / 2 - 6, -D / 2 + 5.75, 3, 2.5, 0, 2.6, '#2a5aa8')
      box(W / 2 - 6, -D / 2 + 5.75, 3.6, 3.1, 2.6, 0.12, '#9a9a96', mats.roofs)
      box(W / 2 - 6, -D / 2 + 4.48, 1.6, 0.06, 1.0, 0.9, '#1a2a30')
      board('TICKETS', W / 2 - 6, -D / 2 + 4.42, 2.15, 2.6, 0.5, 'transport')
      // Its name at the entrance, on two posts.
      for (const u of [-4, 4]) box(u - W / 2 + 10, -D / 2 + 0.6, 0.15, 0.15, 0, 4.4, '#4a4a48')
      board(s.title, -W / 2 + 10, -D / 2 + 0.5, 3.8, 8.6, 1.0, 'transport')
      // The vehicles waiting for their passengers, in a row under and beyond the shelter.
      const models = vehicleModels(vehicles.scene)
      const parked: [string, number, number, string][] = [
        ['bus', -12, 7, '#f0f0ee'],
        ['bus', -4, 7, '#e8c020'],
        ['sedan', 4, 7, '#e9b51c'],
        ['sedan', 8.5, 7, '#e9b51c'],
        ['kekeh', 12.5, 7, '#e8b41c'],
        ['kekeh', 15, 7, '#2a6ab8'],
        ['sedan', -14, 11, '#e9b51c'],
        ['bus', 6, 11, '#f0f0ee'],
      ]
      for (const [name, u, v, paint] of parked) {
        const m = models[name]
        if (!m) continue
        const car = m.clone(true)
        car.traverse((o: Object3D) => {
          const mesh = o as Mesh
          if (!mesh.isMesh) return
          const mat = mesh.material as MeshStandardMaterial
          if (mat.name.startsWith('paint')) {
            mesh.material = mat.clone()
            ;(mesh.material as MeshStandardMaterial).color = new Color(paint)
          }
        })
        // Nose toward the road (the models face +x).
        car.position.set(u, 0.03, -v)
        car.rotation.y = -Math.PI / 2
        group.add(car)
      }
    }
    // (The boards are in the town's frame: drawn beside the turned group, not in it.)
    const boards = signMesh(signs)
    return { group, boards }
  }, [s, mats, vehicles])
  useEffect(() => () => boards?.dispose(), [boards])
  return (
    <>
      <primitive object={group} />
      {boards && <primitive object={boards.mesh} />}
    </>
  )
}

// ---- The scene ---------------------------------------------------------------------------------

/** How far a street built by hand reaches: its reach, or its farthest building if farther. */
const hubExtents = new Map<string, number>()
function hubExtent(town: Hub['town']) {
  const known = hubExtents.get(town)
  if (known !== undefined) return known
  const where = TOWNS[town]
  let far = where.plan.reach
  for (const poly of where.polys) for (const [x, y] of poly.points as number[][]) far = Math.max(far, Math.hypot(x!, y!))
  hubExtents.set(town, far)
  return far
}

/** The streets built by hand in each town, where they are on its map. */
function hubsOf(town: string, map: TownMap): Hub[] {
  if (town !== 'Monrovia') return []
  const out: Hub[] = []
  for (const t of ['sinkor', 'waterside', 'skd'] as const) {
    const at = map.places[t]
    if (at) out.push({ town: t, x: at.x, y: at.y })
  }
  return out
}

/** The game's own compounds in each town, at their places on its map: the family's house, the
 * Ministry of Health. */
function compoundsOf(town: string, map: TownMap, city: City): Compound[] {
  if (town !== 'Monrovia') return []
  const out: Compound[] = []
  const home = map.places.home
  if (home) out.push(compoundAt(city, 'home', home.x, home.y, COMPOUNDS_BUILT.home.w, COMPOUNDS_BUILT.home.d, { w: 12, d: 10, h: 3.2, colour: '#e8d6a6', roof: 'hip' }, '#d8d0c0'))
  const health = map.places.health
  if (health) out.push(compoundAt(city, 'health', health.x, health.y, COMPOUNDS_BUILT.health.w, COMPOUNDS_BUILT.health.d, { w: 15, d: 11, h: 6.9, colour: '#e9e0c6', roof: 'flat' }, '#d8d0c0'))
  return out
}

export default function CityScene(props: Props) {
  const map = useTownMap(props.town)
  const city = useMemo(() => (map.data ? buildCity(map.data as unknown as TownMapData) : null), [map.data])
  const hubs = useMemo(() => (map.data ? hubsOf(props.town, map.data) : []), [map.data, props.town])
  const compounds = useMemo(() => (map.data && city ? compoundsOf(props.town, map.data, city) : []), [map.data, city, props.town])
  const sites = useMemo(() => (map.data && city ? sitesOf(props.town, map.data, city) : []), [map.data, city, props.town])
  const keep = useMemo<Keep[]>(
    () => [
      // A street built by hand: the town gives way to all of it (its farthest building, not just its reach).
      ...hubs.map((h) => ({ x: h.x, y: h.y, r: hubExtent(h.town) + 4 })),
      ...compounds.map((c) => ({ x: c.x, y: c.y, r: Math.max(c.w, c.d) / 2 + 3, roads: false })),
      ...sites.map((x) => ({ x: x.x, y: x.y, r: Math.max(x.w, x.d) / 2 + 3, roads: false, solids: siteSolids(x).map((p) => [...p]) })),
      ...(props.town === 'Monrovia' ? LANDMARKS : []).map((l) => ({ x: l.x, y: l.y, r: l.clear, roads: false, solids: landmarkSolids(l) })),
    ],
    [hubs, compounds, sites, props.town],
  )
  // The places: the hubs' own (in town metres), the compounds' gates.
  const places = useMemo<CityPlace[]>(() => {
    const out: CityPlace[] = []
    // A hub's own places (Sinkor's by their names; any other hub's as "hub:place").
    for (const h of hubs) for (const [name, at] of Object.entries(TOWNS[h.town].places)) out.push({ name: h.town === 'sinkor' ? name : `${h.town}:${name}`, x: at!.x + h.x, y: at!.y + h.y, face: at!.face })
    // The visa office's and the job centre's doors; the parking station's ticket booth.
    for (const x of sites) out.push({ name: x.name, ...siteDoor(x), out: 2.5 })
    for (const c of compounds) {
      // Facing in (from the gate toward the back).
      const face = [-Math.sin(c.yaw), Math.cos(c.yaw)]
      const at = (name: string, u: number, v: number) => {
        const [x, y] = compoundPoint(c, u, v)
        // Out of the door: on the path down the middle of the yard, facing the gate.
        out.push({ name, x, y, face, exit: compoundPoint(c, 0, -11.5) })
      }
      if (c.name === 'home') {
        // On the porch before the front door (the house's inside is in through it).
        const front = COMPOUNDS_BUILT.home.plan.doors?.find((d) => d.name === 'door_front')
        at('home', front?.cx ?? 0, -5.9)
      } else if (c.name === 'health') {
        // At the gate, where the guards are; at the hall's door, past the forecourt.
        at('health-gate', 0, -17.6)
        at('health', 0, -5.9)
      }
    }
    return out
  }, [hubs, compounds, sites, map.data, city])
  useEffect(() => props.onReady?.(places), [places]) // eslint-disable-line react-hooks/exhaustive-deps
  // Where a ride can take one: the family's gate, the hubs where they are entered, the Ministry,
  // the job board, the embassies, the motor park.
  useEffect(() => {
    if (!city) return
    const list: Destination[] = []
    const of = (name: string) => places.find((p) => p.name === name)
    for (const name of ['home', 'phone', 'starline', 'citrus', 'sinkor', 'health', 'waterside', 'skd', 'jobs', 'visa', 'station']) {
      const hub = hubs.find((h) => h.town === name)
      if (hub) {
        const sp = TOWNS[hub.town].plan.spawn
        list.push({ name, x: sp.x + hub.x, y: sp.y + hub.y })
      } else {
        const p = of(name)
        if (p) list.push({ name, x: p.x, y: p.y })
      }
    }
    props.onDestinations?.(list)
  }, [places, hubs, city]) // eslint-disable-line react-hooks/exhaustive-deps
  // Where to start: the point given; out of a place's door (a step toward the street, facing it);
  // where a hub street is entered.
  const start = useMemo(() => {
    const given = props.start
    if ('x' in given) return given
    if (given.place.startsWith('enter:')) {
      const h = hubs.find((x) => x.town === given.place.slice(6))
      if (h) {
        const sp = TOWNS[h.town].plan.spawn
        return { x: sp.x + h.x, y: sp.y + h.y, f: TOWNS[h.town].spawnYaw }
      }
    }
    const at = places.find((p) => p.name === given.place)
    if (!at) return null
    // A few steps out of the door (more where a porch or a step is: room for the camera behind).
    const out = at.out ?? 1.0
    if (at.exit) return { x: at.exit[0], y: at.exit[1], f: Math.atan2(-at.face[0]!, at.face[1]!) }
    return { x: at.x - at.face[0]! * out, y: at.y - at.face[1]! * out, f: Math.atan2(-at.face[0]!, at.face[1]!) }
  }, [props.start, places, hubs])
  const player = useRef({ x: 0, y: 0 })
  if (start && player.current.x === 0 && player.current.y === 0) player.current = { x: start.x, y: start.y }
  const solids = useRef(new Map<string, Solid[]>())
  const ownRide = useRef<RideState>(newRide())
  const ride = props.ride ?? ownRide
  return (
    <Canvas frameloop={props.hidden ? 'never' : 'always'} dpr={[1, 1.5]} camera={{ fov: 60, near: 0.1, far: 700, position: [0, 2.4, 3] }} gl={{ antialias: true }} style={{ touchAction: 'none' }}>
      <color attach="background" args={['#c9d9e6']} />
      <fog attach="fog" args={['#c9d9e6', 110, 480]} />
      <Light />
      <DayNight clock={props.clock} player={player} />
      {props.target && <Beam at={props.target} />}
      <Signals />
      <Stats />
      {city && (
        <>
          <Ground player={player} />
          <Water city={city} />
          <Chunks city={city} map={map.data as unknown as TownMapData} keep={keep} player={player} solids={solids} town={props.town} />
          <Suspense fallback={null}>
            {compounds.map((c) => (
              <Optional key={c.name}>
                <CompoundModel c={c} />
              </Optional>
            ))}
            {sites.map((x) => (
              <Optional key={x.name}>
                <SiteModel s={x} />
              </Optional>
            ))}
            {compounds
              .filter((c) => c.name === 'home')
              .map((c) => (
                <Optional key="own-car">
                  <OwnCarModel c={c} />
                </Optional>
              ))}
          </Suspense>
          <Suspense fallback={null}>
            <Optional>
              <NearHubs hubs={hubs} player={player} />
            </Optional>
            <Optional>{props.town === 'Monrovia' && <NearLandmarks player={player} />}</Optional>
            <Optional>
              <CityTraffic city={city} keep={keep} player={player} moving={cityMoving} ride={ride} onRide={(p) => props.onRide?.(p)} />
            </Optional>
            <Optional>
              <Trees player={player} />
            </Optional>
            {props.town === 'Monrovia' && (
              <Optional>
                <NearInsides player={player} />
              </Optional>
            )}
            <Optional>
              <CityWalkers city={city} keep={keep} player={player} />
            </Optional>
            {start && <Walker props={props} city={city} start={start} compounds={compounds} hubs={hubs} places={places} solids={solids} player={player} />}
          </Suspense>
        </>
      )}
    </Canvas>
  )
}

/** Where a compound stands: by the road nearest a point on the map, its gate to that road. */
export function compoundAt(city: City, name: string, x: number, y: number, w: number, d: number, building: Compound['building'], wall = '#d8d0c0'): Compound {
  const road = nearestRoad(city, x, y, 120)
  if (!road) return { name, x, y, yaw: 0, w, d, building, wall }
  // From the road toward the point: the compound's front faces the road.
  let nx = x - road.px
  let ny = y - road.py
  const n = Math.hypot(nx, ny) || 1
  nx /= n
  ny /= n
  const off = road.seg.w / 2 + 2.5 + d / 2
  const cx = road.px + nx * off
  const cy = road.py + ny * off
  // Local v points from the gate (front, -v) back into the compound: v = (nx, ny).
  const yaw = Math.atan2(ny, nx) - Math.PI / 2
  return { name, x: cx, y: cy, yaw, w, d, building, wall }
}
