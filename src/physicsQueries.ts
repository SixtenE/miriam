import type { RapierContext } from '@react-three/rapier'
import { ROBOT_RADIUS } from './arenaMath.ts'

type World = RapierContext['world']
type CastArgs = Parameters<World['castShape']>

/** Allow the robot to move out of initial overlap with freshly released cargo. */
export function castRobotMovement(world: World, rapier: RapierContext['rapier'], position: CastArgs[0], rotation: CastArgs[1], velocity: CastArgs[2], dt: number, robot?: CastArgs[10]) {
  return world.castShape(position, rotation, velocity, new rapier.Ball(ROBOT_RADIUS), .001, dt,
    false, undefined, undefined, undefined, robot, collider => collider.translation().y > .05)
}
