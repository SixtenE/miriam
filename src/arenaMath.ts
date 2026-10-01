export const ROBOT_RADIUS = 0.25
export const MAX_RANGE = 2.55
export type ArenaConfig = { startX: number; startWallDistance: number; rightExtension: number; lowerExtension: number; yDistance: number; wallHeight: number; sensorOffset: number; touchOffset: number; heading: number }
export const DEFAULT_CONFIG: ArenaConfig = { startX: 2, startWallDistance: 0.5, rightExtension: 1, lowerExtension: 1, yDistance: 1, wallHeight: 0.3, sensorOffset: 0.25, touchOffset: 0.24, heading: 180 }
export function courseLayout(config: ArenaConfig) {
  const width = config.startX + 2 + config.rightExtension, depth = config.yDistance + config.lowerExtension
  const left = -width / 2, top = -depth / 2
  return { width, depth, left, top, start: { x: left + config.startX, z: top + config.startWallDistance }, targetX: { x: left + config.startX + 2, z: top }, targetY: { x: left, z: top + config.yDistance }, floorWidth: width + 1, floorDepth: depth + 1.5 }
}
/** Ray intersections with the two finite course walls; open sides return maximum range. */
export function wallDistance(x: number, z: number, heading: number, config: ArenaConfig): number {
  const layout = courseLayout(config), dx = Math.sin(heading), dz = Math.cos(heading)
  const ox = x + dx * config.sensorOffset, oz = z + dz * config.sensorOffset
  const hits = [MAX_RANGE]
  if (Math.abs(dz) > 1e-10) {
    const t = (layout.top - oz) / dz, atX = ox + t * dx
    if (t >= -1e-8 && atX >= layout.left - 1e-8 && atX <= layout.left + layout.width + 1e-8) hits.push(Math.max(0,t))
  }
  if (Math.abs(dx) > 1e-10) {
    const t = (layout.left - ox) / dx, atZ = oz + t * dz
    if (t >= -1e-8 && atZ >= layout.top - 1e-8 && atZ <= layout.top + layout.depth + 1e-8) hits.push(Math.max(0,t))
  }
  return Math.min(...hits)
}
