// Monrovia's landmarks (scripts/oal/makeLandmarks.py), each standing on its real footprint: where
// (town metres), turned by yaw (map radians: the model's x along it, its front toward -v), its
// own point (u, v in the model) set on that spot, the ground cleared round it, its walls solid.

export type Landmark = {
  name: string
  /** Its own name (as on the map). */
  title: string
  url: string
  x: number
  y: number
  yaw: number
  /** The model's point set on (x, y): the building's middle (a plaza before it is not). */
  at: [number, number]
  /** How far round the city's own buildings give way to it. */
  clear: number
  /** Its walls (rectangles in the model, u0 v0 u1 v1). */
  solid: [number, number, number, number][]
}

export const LANDMARKS: Landmark[] = [
  // Facing the Executive Mansion across Capitol Bypass.
  { name: 'capitol', title: 'Capitol Building', url: '/oal/landmarks/capitol.v2.glb', x: -634.2, y: -304.8, yaw: -1.589, at: [0, 0], clear: 56, solid: [[-44, -34, 44, 40]] },
  { name: 'mansion', title: 'Executive Mansion', url: '/oal/landmarks/mansion.v2.glb', x: -909.6, y: -470.1, yaw: 2.069, at: [0, 10], clear: 58, solid: [[-46.6, -7.1, 46.6, 20.5]] },
  // On Mamba Point, its front to the sea.
  { name: 'ducor', title: 'Ducor Hotel', url: '/oal/landmarks/ducor.v2.glb', x: -2545.7, y: 1740.5, yaw: 0.516, at: [0, 9], clear: 40, solid: [[-30.5, -0.6, 30.5, 18]] },
  // Broad Street at Center Street, its steps down to Center Street.
  { name: 'providence', title: 'Providence Baptist Church', url: '/oal/landmarks/providence.v2.glb', x: -1576.7, y: 1406.5, yaw: 4.351, at: [0, 0], clear: 22, solid: [[-18, -8.6, 18, 8.6]] },
  // At JFK Medical Center (its buildings not on the map), its front to the street.
  { name: 'jfk', title: 'Liberian-Japanese Friendship Maternity Hospital', url: '/oal/landmarks/jfk.v2.glb', x: 1833.1, y: -1976.7, yaw: 2.32, at: [0, 0], clear: 40, solid: [[-36.3, -7.3, 36.3, 7.3]] },
]

/** A point in a landmark's model on the town's map. */
export function landmarkPoint(l: Landmark, u: number, v: number): [number, number] {
  const c = Math.cos(l.yaw)
  const s = Math.sin(l.yaw)
  const du = u - l.at[0]
  const dv = v - l.at[1]
  return [l.x + c * du - s * dv, l.y + s * du + c * dv]
}

/** Its walls as the city's solids (polygons on the map). */
export function landmarkSolids(l: Landmark): number[][][] {
  return l.solid.map(([u0, v0, u1, v1]) => [landmarkPoint(l, u0, v0), landmarkPoint(l, u1, v0), landmarkPoint(l, u1, v1), landmarkPoint(l, u0, v1)])
}
