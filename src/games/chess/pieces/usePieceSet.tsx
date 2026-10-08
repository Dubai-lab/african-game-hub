import { useEffect, useState } from 'react'
import type { PieceRenderObject } from 'react-chessboard'
import type { PieceSetId } from '@/core/settings/settingsStore'

export const PIECE_SET_IDS: PieceSetId[] = ['hub', 'chessnut', 'rhosgfx']

// Each set is its own chunk: a player only downloads the one they use.
const loaders: Record<PieceSetId, () => Promise<{ default: Record<string, string> }>> = {
  hub: () => import('./hub'),
  chessnut: () => import('./chessnut'),
  rhosgfx: () => import('./rhosgfx'),
}

export type PieceSet = {
  /** Image address for a piece code such as "wK" or "bN". */
  urls: Record<string, string>
  /** The shape react-chessboard wants. */
  render: PieceRenderObject
}

const cache = new Map<PieceSetId, PieceSet>()

function build(files: Record<string, string>): PieceSet {
  const urls: Record<string, string> = {}
  const render: PieceRenderObject = {}
  for (const [path, url] of Object.entries(files)) {
    const code = path.slice(path.lastIndexOf('/') + 1, -4)
    urls[code] = url
    render[code] = (props) => (
      <img
        src={url}
        alt=""
        draggable={false}
        style={{ width: '100%', height: '100%', pointerEvents: 'none', ...props?.svgStyle }}
      />
    )
  }
  return { urls, render }
}

/** The chosen piece set, or null while it downloads (and if it cannot be downloaded). */
export function usePieceSet(id: PieceSetId): PieceSet | null {
  const [loaded, setLoaded] = useState<{ id: PieceSetId; set: PieceSet } | null>(() => {
    const hit = cache.get(id)
    return hit ? { id, set: hit } : null
  })

  useEffect(() => {
    const hit = cache.get(id)
    if (hit) return setLoaded({ id, set: hit })
    let active = true
    loaders[id]()
      .then((module) => {
        const set = build(module.default)
        cache.set(id, set)
        if (active) setLoaded({ id, set })
      })
      .catch(() => {
        // Offline with this set never downloaded: keep showing whichever set is already on screen.
      })
    return () => {
      active = false
    }
  }, [id])

  return loaded?.set ?? null
}
