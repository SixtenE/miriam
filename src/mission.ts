import {courseLayout} from './arenaMath.ts'
import type {ArenaConfig} from './arenaMath.ts'
import type {Program} from './runtime.ts'
export type Destination = 'X' | 'Y'
export const CAN = {height: .135, radius: .0275, mass: .25}
export const CARGO_OFFSET = -.22 // Rear claw, relative to the forward-facing ultrasonic sensor.
export const DELIVERY_TOLERANCE = .5
export const WALL_GAP_TOLERANCE = .03 // Simulation proxy for "against the wall".
export const RETURN_TOLERANCE = .2 // A debugger threshold, not a course rule.
export type CanPose = {x: number; z: number; tilt: number; speed: number}
export type DeliveryCheck = {distance: number; wallGap: number; inZone: boolean; againstWall: boolean; upright: boolean; settled: boolean; delivered: boolean}
export type ZoneOccupancy = { X: boolean; Y: boolean }
export type MissionSnapshot = {destination: Destination; cargo: 'loaded' | 'released'; elapsed: number; releaseTime: number | null; check: DeliveryCheck | null; zones: ZoneOccupancy; placed: boolean; returnDistance: number; returned: boolean; peakAcceleration: number; peakTurnRate: number}
const EMPTY_ZONES: ZoneOccupancy = { X: false, Y: false }
/** The painted semicircle: 0.5 m around the target, open into the arena. */
export function inDeliveryArea(config: ArenaConfig, destination: Destination, point: { x: number; z: number }): boolean {
  const m = courseLayout(config), target = destination === 'X' ? m.targetX : m.targetY
  if (Math.hypot(point.x - target.x, point.z - target.z) > DELIVERY_TOLERANCE) return false
  return destination === 'X' ? point.z >= m.top : point.x >= m.left
}
export function zoneOccupancy(config: ArenaConfig, point: { x: number; z: number }): ZoneOccupancy {
  return { X: inDeliveryArea(config, 'X', point), Y: inDeliveryArea(config, 'Y', point) }
}
export function assessDelivery(config: ArenaConfig, destination: Destination, can: CanPose): DeliveryCheck {
  const m = courseLayout(config), target = destination === 'X' ? m.targetX : m.targetY
  const distance = Math.hypot(can.x-target.x, can.z-target.z)
  const axisDistance = destination === 'X' ? can.z-m.top : can.x-m.left
  const alongWall = destination === 'X' ? can.x >= m.left && can.x <= m.left+m.width : can.z >= m.top && can.z <= m.top+m.depth
  const wallGap = axisDistance-CAN.radius
  const inZone = inDeliveryArea(config, destination, can)
  const againstWall = alongWall && wallGap >= -.002 && wallGap <= WALL_GAP_TOLERANCE
  const upright = can.tilt <= 15, settled = can.speed <= .03
  return {distance, wallGap, inZone, againstWall, upright, settled, delivered: inZone && againstWall && upright && settled}
}
export class DeliveryMission {
  snapshot: MissionSnapshot
  private returnDwell = 0
  private previousSpeed = 0
  private previousHeading: number | null = null
  private can: CanPose | null = null
  readonly config: ArenaConfig
  readonly destination: Destination
  constructor(config: ArenaConfig, destination: Destination) {
    this.config=config;this.destination=destination
    this.snapshot = {destination,cargo:'loaded',elapsed:0,releaseTime:null,check:null,zones:{...EMPTY_ZONES},placed:false,returnDistance:0,returned:false,peakAcceleration:0,peakTurnRate:0}
  }
  release(x: number,z: number,heading: number): {x:number;z:number} | null {
    if(this.snapshot.cargo === 'released')return null
    const pose={x:x+CARGO_OFFSET*Math.sin(heading),z:z+CARGO_OFFSET*Math.cos(heading)}
    this.snapshot.cargo='released';this.snapshot.releaseTime=this.snapshot.elapsed
    this.observeCan({...pose,tilt:0,speed:0})
    return pose
  }
  observeCan(can: CanPose) {this.can=can;this.snapshot.check=assessDelivery(this.config,this.destination,can);this.snapshot.zones=zoneOccupancy(this.config,can);this.snapshot.placed=this.snapshot.zones[this.destination]}
  tick(dt:number,x:number,z:number,heading:number,speed:number,stopped:boolean) {
    this.snapshot.elapsed+=dt
    this.snapshot.peakAcceleration=Math.max(this.snapshot.peakAcceleration,Math.abs(speed-this.previousSpeed)/dt)
    if(this.previousHeading !== null)this.snapshot.peakTurnRate=Math.max(this.snapshot.peakTurnRate,Math.abs(heading-this.previousHeading)/dt*180/Math.PI)
    this.previousSpeed=speed;this.previousHeading=heading
    const start=courseLayout(this.config).start
    this.snapshot.returnDistance=Math.hypot(x-start.x,z-start.z)
    if(this.can){this.snapshot.check=assessDelivery(this.config,this.destination,this.can);this.snapshot.zones=zoneOccupancy(this.config,this.can);this.snapshot.placed=this.snapshot.zones[this.destination]}
    const ready=this.snapshot.check?.delivered && this.snapshot.returnDistance<=RETURN_TOLERANCE && stopped
    this.returnDwell=ready?this.returnDwell+dt:0
    this.snapshot.returned=this.returnDwell>=1
  }
  read():MissionSnapshot{return structuredClone(this.snapshot)}
}
/** Preserve the imported program; identify its motor B opening command. */
export function releaseBlockIds(program:Program):Set<string> {
  return new Set(program.targets.flatMap(t=>t.functions.filter(f=>f.name==='drop off').flatMap(f=>f.steps.filter(b=>b.opcode==='ev3motor_motorTurnFor' && b.fields?.DIRECTION.value==='clockwise' && b.inputs?.PORT.value.fields?.outputPort.value==='2').map(b=>b.block_id))))
}
export function randomHeading(random:()=>number = Math.random):number{return Math.floor(random()*360)}
