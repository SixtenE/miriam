import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ComponentRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid, Html, Line, OrbitControls, RoundedBox } from '@react-three/drei'
import { BallCollider, CylinderCollider, Physics, RigidBody, useRapier } from '@react-three/rapier'
import type { RapierRigidBody } from '@react-three/rapier'
import { DoubleSide, Quaternion, Vector3 } from 'three'
import { EV3Runtime, EMPTY_EXECUTION } from './runtime'
import { loadProgram } from './lmsp'
import type { ExecutionSnapshot, Program, Value } from './runtime'
import LiveCodeViewer from './LiveCodeViewer'
import { DEFAULT_CONFIG, MAX_RANGE, ROBOT_RADIUS, courseLayout, wallDistance } from './arenaMath'
import type { ArenaConfig } from './arenaMath'
import { CAN, CARGO_OFFSET, DeliveryMission, releaseBlockIds } from './mission'
import type { Destination, MissionSnapshot, ZoneOccupancy } from './mission'
import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react'
import HardwareStrip from './HardwareStrip'
import VariablesPanel from './VariablesPanel'
import { castRobotMovement } from './physicsQueries'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const DT = 1 / 60
const Y = 0.24
const SPEED = 2 / 5.684 // 2 wheel rotations per second at full motor power.
type View = 'overhead' | 'orbit'
type Controls = { running: boolean; stepRequest: number; speed: number; halt: () => void }
type Telemetry = { variables: Record<string, Value> | null; gyro: number; motorOutputs: Record<string,number>; time: number; distance: number; angle: number; touch2: boolean; touch3: boolean; blocked: boolean; wheels: [number, number]; active: string[]; error: string; threads: number; execution: ExecutionSnapshot; mission?: MissionSnapshot; x: number; z: number }
const gyroAngle = (heading: number) => -heading
const initial = (config: ArenaConfig): Telemetry => { const start = courseLayout(config).start; return ({ variables: null, gyro: gyroAngle(config.heading), motorOutputs: {'1':0,'2':0,'3':0,'4':0}, time: 0, distance: wallDistance(courseLayout(config).start.x, courseLayout(config).start.z, config.heading * Math.PI / 180, config) * 100, angle: gyroAngle(config.heading), touch2: false, touch3: false, blocked: false, wheels: [0, 0], active: [], error: '', threads: 0, execution: EMPTY_EXECUTION, x: start.x, z: start.z }) }

function Box({ position, size, color }: { position: [number, number, number]; size: [number, number, number]; color: string }) {
  return <mesh position={position} castShadow receiveShadow><boxGeometry args={size} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>
}
function CameraView({ view, width, depth }: { view: View; width: number; depth: number }) {
  const { camera, size: viewport } = useThree()
  const size = Math.max(depth, width / (viewport.width / viewport.height)) / (2 * Math.tan(21 * Math.PI / 180)) * 1.2
  const minDistance = size * 0.65
  const orbit = useRef<ComponentRef<typeof OrbitControls>>(null)
  useLayoutEffect(() => {
    camera.up.set(0, 1, 0)
    if (view === 'overhead') camera.position.set(0, size, 0.001)
    else camera.position.copy(new Vector3(1.2, 1.25, 1.4).normalize().multiplyScalar(minDistance))
    camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); orbit.current?.update()
  }, [camera, view, size, minDistance])
  return <OrbitControls ref={orbit} key={view} makeDefault target={[0, 0, 0]} enableRotate={view === 'orbit'} minDistance={minDistance} maxDistance={size * 5} maxPolarAngle={Math.PI / 2.1} />
}
function CanModel() {
  const visualScale = 2.5
  return <group scale={visualScale} position={[0, CAN.height * (visualScale - 1) / 2, 0]}>
    <mesh receiveShadow><cylinderGeometry args={[CAN.radius,CAN.radius,CAN.height,32]} /><meshStandardMaterial color="#c4cec8" metalness={0.7} roughness={0.28} /></mesh>
    <mesh><cylinderGeometry args={[CAN.radius+.0005,CAN.radius+.0005,CAN.height*.65,32]} /><meshStandardMaterial color="#da7a45" roughness={0.6} /></mesh>
    <mesh position={[0,CAN.height/2+.001,0]}><cylinderGeometry args={[CAN.radius*.93,CAN.radius*.93,.002,32]} /><meshStandardMaterial color="#dce4de" metalness={0.8} roughness={0.25} /></mesh>
    <mesh position={[0,CAN.height/2+.003,0]} rotation={[-Math.PI/2,0,0]}><torusGeometry args={[.007,.0017,8,16]} /><meshStandardMaterial color="#6e7973" metalness={0.7} /></mesh>
  </group>
}
function Robot({ config, controls, runtime, mission, openingIds, inputIds, report }: { config: ArenaConfig; controls: Controls; runtime: EV3Runtime | null; mission: DeliveryMission; openingIds: Set<string>; inputIds: Record<string,string>; report: (t: Telemetry) => void }) {
  const body = useRef<RapierRigidBody>(null), canBody = useRef<RapierRigidBody>(null)
  const [released, setReleased] = useState<{x:number;z:number} | null>(null)
  const releasePending = useRef(false), briefed = useRef(false)
  useEffect(() => runtime?.subscribe(event => {
    if (event.type === 'block-complete' && event.blockId && openingIds.has(event.blockId)) releasePending.current = true
  }), [runtime, openingIds])
  const clock = useRef(0)
  const heading = useRef(config.heading * Math.PI / 180)
  const blocked = useRef(false)
  const { world, rapier, step } = useRapier()
  const [beam, setBeam] = useState(wallDistance(courseLayout(config).start.x, courseLayout(config).start.z, config.heading * Math.PI / 180, config))
  const senses = () => {
    const robot = body.current
    if (!robot) return { distance: beam * 100, angle: gyroAngle(config.heading), touch2: false, touch3: false }
    const position = robot.translation(), direction = new Vector3(Math.sin(heading.current), 0, Math.cos(heading.current))
    const origin = { x: position.x + direction.x * config.sensorOffset, y: 0.15, z: position.z + direction.z * config.sensorOffset }
    const rayHit = world.castRay(new rapier.Ray(origin, direction), MAX_RANGE, true, undefined, undefined, undefined, robot)
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), heading.current)
    const touches = [-0.09, 0.09].map(offset => {
      const point = new Vector3(offset, 0.15, 0.12).applyQuaternion(rotation).add(new Vector3(position.x, position.y, position.z))
      const contact = world.intersectionWithShape(point, rotation, new rapier.Cuboid(0.025, 0.009, 0.025), undefined, undefined, undefined, robot, c => c.translation().y > 0.05)
      return !!contact
    })
    return { distance: (rayHit?.timeOfImpact ?? MAX_RANGE) * 100, angle: gyroAngle(heading.current * 180 / Math.PI), touch2: touches[0], touch3: touches[1] }
  }
  const advance = (singleStep = false) => {
    const robot = body.current
    if (!robot || !runtime) return false
    const briefing = !briefed.current && clock.current >= .3 && ['confirmed','path','is running'].every(name => inputIds[name] && Number(runtime.variables[inputIds[name]]) === 0)
    const input = senses()
    if (briefing) { if (mission.destination === 'X') input.touch3 = true; else input.touch2 = true }
    if (!runtime.tick(DT, input, singleStep)) { controls.halt(); return false }
    if (briefing) briefed.current = true
    clock.current += DT
    const wheels = runtime.wheels
    const left = wheels[0] / 100 * SPEED, right = wheels[1] / 100 * SPEED
    // Positive wheel speed drives the claw, away from the sensor, so a "back" move approaches the wall.
    // Gyro is clockwise-positive, opposite this heading, so left +, right − turns toward +X.
    heading.current += (right - left) / 0.28 * DT
    const forward = -(left + right) / 2
    const velocity = new Vector3(Math.sin(heading.current), 0, Math.cos(heading.current)).multiplyScalar(forward)
    const position = robot.translation()
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), heading.current)
    const hit = velocity.lengthSq() > 0 ? castRobotMovement(world, rapier, position, rotation, velocity, DT, robot) : null
    blocked.current = !!hit
    const travel = hit ? Math.max(0, hit.time_of_impact - 0.0001) : DT
    // Walls and released cargo constrain motion; existing contact can separate freely.
    robot.setNextKinematicTranslation({ x: position.x + velocity.x * travel, y: Y, z: position.z + velocity.z * travel })
    robot.setNextKinematicRotation(rotation)
    step(DT)
    const nextPosition = robot.translation()
    if (releasePending.current) {
      releasePending.current = false
      const pose = mission.release(nextPosition.x,nextPosition.z,heading.current)
      if (pose) setReleased(pose)
    }
    if (canBody.current) {
      const can = canBody.current, p = can.translation(), q = can.rotation(), velocity = can.linvel()
      const up = new Vector3(0,1,0).applyQuaternion(new Quaternion(q.x,q.y,q.z,q.w))
      mission.observeCan({x:p.x,z:p.z,tilt:Math.acos(Math.max(-1,Math.min(1,up.y)))*180/Math.PI,speed:Math.hypot(velocity.x,velocity.y,velocity.z)})
    }
    mission.tick(DT,nextPosition.x,nextPosition.z,heading.current,Math.hypot(nextPosition.x-position.x,nextPosition.z-position.z)/DT,wheels.every(v=>Math.abs(v)<1))
    if (runtime.error) controls.halt()
    return true
  }
  const refresh = useRef(0), accumulator = useRef(0), prepared = useRef(false), lastStep = useRef(controls.stepRequest)
  useFrame((_, delta) => {
    if (!prepared.current) {
      if (world.colliders.len() < 4) return
      step(DT); prepared.current = true
    }
    while (lastStep.current < controls.stepRequest) { lastStep.current++; advance(true); refresh.current = 1 }
    if (controls.running) {
      accumulator.current += Math.min(delta, 0.1) * controls.speed
      let steps = 0
      while (accumulator.current >= DT && steps < 30) {
        accumulator.current -= DT
        steps++
        if (!advance()) { accumulator.current = 0; refresh.current = 1; break }
      }
      if (steps === 30) accumulator.current = 0
    } else accumulator.current = 0
    refresh.current += delta
    if (refresh.current < 0.1 || !body.current) return
    refresh.current = 0
    const sensors = senses(), position = body.current.translation()
    setBeam(sensors.distance / 100)
    report({ variables: runtime ? {...runtime.variables} : null, ...sensors, gyro: runtime ? runtime.gyro : sensors.angle, motorOutputs: runtime ? {...runtime.motors} : {'1':0,'2':0,'3':0,'4':0}, time: clock.current, blocked: blocked.current, wheels: runtime ? runtime.wheels : [0, 0], active: runtime ? [...runtime.active] : [], error: runtime ? runtime.error : '', threads: runtime ? runtime.threadCount : 0, execution: runtime ? runtime.snapshot() : EMPTY_EXECUTION, mission: mission.read(), x: position.x, z: position.z })
  })
  return <><RigidBody ref={body} type="kinematicPosition" position={[courseLayout(config).start.x, Y, courseLayout(config).start.z]} rotation={[0, config.heading * Math.PI / 180, 0]} colliders={false}>
    <BallCollider args={[ROBOT_RADIUS]} />
    {!released && <group position={[0,-.02,CARGO_OFFSET]}><CanModel /></group>}
    <RoundedBox args={[0.29, 0.15, 0.36]} radius={0.025} castShadow><meshStandardMaterial color="#e9e8df" /></RoundedBox>
    <Box position={[0, 0.11, -0.02]} size={[0.20, 0.1, 0.22]} color="#f7f5ef" />
    <Box position={[0, 0.166, -0.04]} size={[0.13, 0.015, 0.12]} color="#374344" />
    <Box position={[0, 0.179, -0.04]} size={[0.10, 0.008, 0.08]} color="#a5c3a4" />
    <Box position={[0, 0.17, 0.055]} size={[0.035, 0.018, 0.035]} color="#cf552e" />
    {[-1, 1].map(side => <group key={side}>
      <mesh position={[side * 0.19, -0.08, -0.04]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.13, 0.13, 0.075, 32]} /><meshStandardMaterial color="#282e2d" roughness={0.9} /></mesh>
      <mesh position={[side * 0.231, -0.08, -0.04]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.065, 0.065, 0.008, 24]} /><meshStandardMaterial color="#858c87" /></mesh>
      <group position={[side * (released ? .13 : .085), .015, CARGO_OFFSET]} rotation={[0, side * (released ? -.45 : 0), 0]}>
        <Box position={[0, 0, .04]} size={[.025, .12, .20]} color="#c85e3b" />
        <Box position={[-side*.024, 0, -.065]} size={[.07, .12, .025]} color="#374344" />
      </group>
      <mesh position={[side * 0.055, -0.09, config.sensorOffset - 0.02]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.031, 0.031, 0.04, 24]} /><meshStandardMaterial color="#252c2c" /></mesh>
    </group>)}
    <Box position={[0,-.095,CARGO_OFFSET]} size={[.20,.025,.19]} color="#374344" />
    {[-0.09, 0.09].map(x => <group key={x} position={[x,.12,.12]}>
      <Box position={[0,0,0]} size={[.065,.045,.075]} color="#e9e8df" />
      <mesh position={[0,.03,0]} castShadow>
        <cylinderGeometry args={[.025,.025,.015,24]} />
        <meshStandardMaterial color="#bf5941" />
      </mesh>
    </group>)}
    <Line points={[[0, -0.09, config.sensorOffset], [0, -0.09, config.sensorOffset + beam]]} color="#d46e33" transparent opacity={0.8} dashed dashSize={0.035} gapSize={0.025} lineWidth={2} />
  </RigidBody>
  {released && <RigidBody ref={canBody} type="dynamic" colliders={false} position={[released.x,CAN.height/2+.002,released.z]} friction={0.8} restitution={0} linearDamping={2} angularDamping={2} canSleep>
    <CylinderCollider args={[CAN.height/2,CAN.radius]} mass={CAN.mass} />
    <CanModel />
  </RigidBody>}
  </>
}
function MapLabel({ position, children, dimension = false }: { position: [number, number, number]; children: React.ReactNode; dimension?: boolean }) {
  return <Html position={position} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}><span className={dimension ? 'rounded bg-background/80 px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-muted-foreground' : 'rounded bg-background/90 px-1.5 py-0.5 text-xs font-bold whitespace-nowrap text-foreground shadow-sm'}>{children}</span></Html>
}
function CourseMarkers({ config, zones }: { config: ArenaConfig; zones: ZoneOccupancy }) {
  const m = courseLayout(config)
  const areaColor = (occupied: boolean) => occupied ? '#e8a317' : '#24ae56'
  return <>
    <mesh position={[m.start.x, 0.008, m.start.z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.32, 0.45]} /><meshBasicMaterial color="#1ca450" side={DoubleSide} /></mesh>
    <mesh position={[m.targetX.x, 0.01, m.targetX.z]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.5, 48, Math.PI, Math.PI]} /><meshBasicMaterial color={areaColor(zones.X)} side={DoubleSide} transparent opacity={zones.X ? 0.95 : 0.8} /></mesh>
    <mesh position={[m.targetY.x, 0.01, m.targetY.z]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.5, 48, -Math.PI / 2, Math.PI]} /><meshBasicMaterial color={areaColor(zones.Y)} side={DoubleSide} transparent opacity={zones.Y ? 0.95 : 0.8} /></mesh>
    <MapLabel position={[m.start.x, 0.03, m.start.z + 0.4]}>START</MapLabel>
    <MapLabel position={[m.targetX.x, 0.03, m.top + 0.23]}>{zones.X ? 'X · can' : 'X'}</MapLabel>
    <MapLabel position={[m.left + 0.23, 0.03, m.targetY.z]}>{zones.Y ? 'Y · can' : 'Y'}</MapLabel>
    <Line points={[[m.start.x, 0.02, m.top + 0.66], [m.targetX.x, 0.02, m.top + 0.66]]} color="#859a7b" dashed dashSize={0.05} gapSize={0.03} />
    <MapLabel position={[(m.start.x + m.targetX.x) / 2, 0.03, m.top + 0.8]} dimension>2 m to X</MapLabel>
    <MapLabel position={[(m.left + m.start.x) / 2, 0.03, m.top - 0.22]} dimension>{config.startX} m</MapLabel>
    <MapLabel position={[m.left + 0.35, 0.03, m.top + config.yDistance / 2]} dimension>Y: {config.yDistance} m</MapLabel>
  </>
}
function Arena({ config, view, controls, runtime, mission, zones, openingIds, inputIds, report, debug }: { config: ArenaConfig; view: View; controls: Controls; runtime: EV3Runtime | null; mission: DeliveryMission; zones: ZoneOccupancy; openingIds: Set<string>; inputIds: Record<string,string>; report: (t: Telemetry) => void; debug: boolean }) {
  const m = courseLayout(config), h = config.wallHeight, thickness = 0.06
  return <>
    <color attach="background" args={['#e7eae3']} /><ambientLight intensity={1.3} />
    <directionalLight position={[3, 6, 2]} intensity={2.7} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7} shadow-bias={-0.001} />
    <Physics paused timeStep={DT} debug={debug}>
      <RigidBody type="fixed"><Box position={[0, -0.06, 0.25]} size={[m.floorWidth, 0.12, m.floorDepth]} color="#f5f4eb" /></RigidBody>
      <RigidBody type="fixed"><Box position={[0, h / 2, m.top - thickness / 2]} size={[m.width + thickness, h, thickness]} color="#5e6e59" /></RigidBody>
      <RigidBody type="fixed"><Box position={[m.left - thickness / 2, h / 2, 0]} size={[thickness, h, m.depth + thickness]} color="#5e6e59" /></RigidBody>
      <Robot config={config} controls={controls} runtime={runtime} mission={mission} openingIds={openingIds} inputIds={inputIds} report={report} />
    </Physics>
    <Grid position={[0, 0.003, 0.25]} args={[m.floorWidth, m.floorDepth]} cellSize={0.25} cellColor="#d9ddd3" sectionSize={1} sectionColor="#c6cdbf" fadeDistance={20} />
    <CourseMarkers config={config} zones={zones} />
    <CameraView view={view} width={m.floorWidth} depth={m.floorDepth} />
  </>
}
const EMPTY_ZONES: ZoneOccupancy = { X: false, Y: false }
function AreaStatus({ destination, zones, released }: { destination: Destination; zones: ZoneOccupancy; released: boolean }) {
  const placed = zones[destination]
  const program = placed ? `can placed in ${destination}` : released ? `can is not in ${destination}` : `waiting for can in ${destination}`
  return <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-xs" role="status" aria-live="polite" aria-label={`X area ${zones.X ? 'can placed' : 'empty'}. Y area ${zones.Y ? 'can placed' : 'empty'}. ${destination} program ${program}.`}>
    <span className={zones.X ? 'font-medium text-foreground' : 'text-muted-foreground'}>X area {zones.X ? 'can placed' : 'empty'}</span>
    <span className={zones.Y ? 'font-medium text-foreground' : 'text-muted-foreground'}>Y area {zones.Y ? 'can placed' : 'empty'}</span>
    <span className={placed ? 'font-medium text-foreground' : 'text-muted-foreground'}>{destination} program: {program}</span>
  </p>
}
function Transport({ running, blocked, time, speed, destination, onDestination, onSpeed, onToggle, onReset, onStep }: { running: boolean; blocked: boolean; time: number; speed: number; destination: Destination; onDestination: (value: Destination) => void; onSpeed: (speed: number) => void; onToggle: () => void; onReset: () => void; onStep: () => void }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
    <Button type="button" disabled={blocked} onClick={onToggle}>{running ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}{running ? 'Pause' : 'Run EV3 program'}</Button>
    <Select value={destination} onValueChange={value => { if (value === 'X' || value === 'Y') onDestination(value) }}>
      <SelectTrigger className="w-36" size="sm" aria-label="Delivery destination"><SelectValue /></SelectTrigger>
                <SelectContent side="top">
        <SelectItem value="X">X · top wall</SelectItem>
        <SelectItem value="Y">Y · left wall</SelectItem>
      </SelectContent>
    </Select>
    <Button type="button" variant="outline" onClick={onReset}><RotateCcw data-icon="inline-start" />Reset</Button>
    <Button type="button" variant="outline" disabled={running || blocked} onClick={onStep}><SkipForward data-icon="inline-start" />Step 1 tick</Button>
    <Label className="ml-auto gap-3 text-xs font-normal text-muted-foreground">Speed<div className="w-32"><Slider aria-label="Simulation speed" min={0.25} max={4} step={0.25} largeStep={1} value={speed} onValueChange={value => { if (typeof value === 'number') onSpeed(value) }} /></div><span className="w-9 text-right font-mono text-sm tabular-nums text-foreground">{Number(speed.toFixed(2))}×</span></Label>
    <span className="font-mono text-sm tabular-nums"><span className="mr-2 font-sans text-xs text-muted-foreground">Time</span>{Math.round(time)}<span className="text-xs text-muted-foreground"> s</span></span>
  </div>
}

function App() {
  const config = DEFAULT_CONFIG
  const [destination, setDestination] = useState<Destination>('X')
  const [running, setRunning] = useState(false), [speed, setSpeed] = useState(1)
  const [showCode, setShowCode] = useState(false), [showVariables, setShowVariables] = useState(true)
  const [reset, setReset] = useState(0), [view, setView] = useState<View>('overhead')
  const [telemetry, setTelemetry] = useState(() => initial(DEFAULT_CONFIG)), [project, setProject] = useState<Program | null>(null)
  const [error, setError] = useState(''), [uploadError, setUploadError] = useState('')
  const [stepRequest, setStepRequest] = useState(0), [breakpoints, setBreakpoints] = useState<Set<string>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)
  const runtime = useMemo(() => { void reset; const engine = project ? new EV3Runtime(project) : null
    // The real buttons begin unpressed for each loaded mission.
    if (engine && project) for (const v of project.targets.flatMap(t=>t.variables)) if (v.name === 'X' || v.name === 'Y') engine.variables[v.id] = 0
    return engine }, [project, reset])
  const mission = useMemo(() => { void reset; return new DeliveryMission(config,destination) }, [config,destination,reset])
  const openingIds = useMemo(() => project ? releaseBlockIds(project) : new Set<string>(), [project])
  const inputIds = useMemo(() => Object.fromEntries(project?.targets.flatMap(t=>t.variables.map(v=>[v.name,v.id])) ?? []), [project])
  useEffect(() => { runtime?.setBreakpoints(breakpoints) }, [runtime, breakpoints])
  useEffect(() => { fetch('/finish_8.json').then(r => { if (!r.ok) throw Error('Program could not be loaded'); return r.json() }).then(setProject).catch(e => setError(String(e))) }, [])
  const restart = (next = config) => { setRunning(false); setStepRequest(0); setTelemetry(initial(next)); setReset(v => v + 1) }
  const applyProgram = (next: Program) => { setError(''); setUploadError(''); setBreakpoints(new Set()); setProject(next); restart() }
  const loadBuiltin = () => {
    setUploadError('')
    fetch('/finish_8.json').then(r => { if (!r.ok) throw Error('Program could not be loaded'); return r.json() }).then(applyProgram).catch(e => setError(String(e)))
  }
  const onUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try { applyProgram(loadProgram(new Uint8Array(await file.arrayBuffer()), file.name)) }
    catch (e) { setUploadError(e instanceof Error ? e.message : String(e)) }
  }
  const downloadProgram = () => {
    if (!project) return
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${project.project_name.replace(/[/\\?%*:|"<>]/g, '') || 'program'}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  const resume = () => { runtime?.resume(); setRunning(true) }
  const toggleBreakpoint = (id: string) => setBreakpoints(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const blocked = !project || !!error || !!telemetry.error
  const rightOpen = showCode || showVariables
  const transportProps = { running, blocked, time: telemetry.time, speed, destination, onDestination: (value: Destination) => { setDestination(value); restart() }, onSpeed: setSpeed, onToggle: () => running ? setRunning(false) : resume(), onReset: () => restart(), onStep: () => setStepRequest(value => value + 1) }
  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
    <HardwareStrip data={telemetry} />
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className={rightOpen ? 'flex h-[45vh] min-h-0 shrink-0 flex-col border-b md:h-auto md:min-w-0 md:flex-1 md:border-b-0' : 'flex min-h-0 flex-1 flex-col'}>
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b px-3 py-2">
          <ToggleGroup variant="outline" size="sm" spacing={0} value={[view]} onValueChange={values => { const next = values[0]; if (next === 'overhead' || next === 'orbit') setView(next) }}>
            <ToggleGroupItem value="overhead">Overhead</ToggleGroupItem>
            <ToggleGroupItem value="orbit">Orbit</ToggleGroupItem>
          </ToggleGroup>
          <Button type="button" variant="outline" size="sm" aria-expanded={showCode} aria-controls="code-overlay" onClick={() => { setShowCode(value => !value); setShowVariables(false) }}>{showCode ? 'Hide code' : 'Code blocks'}</Button>
          <Button type="button" variant="outline" size="sm" aria-expanded={showVariables} aria-controls="variables-overlay" onClick={() => { setShowVariables(value => !value); setShowCode(false) }}>{showVariables ? 'Hide variables' : 'Variables'}</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>Upload program</Button>
          <input ref={fileRef} type="file" accept=".lmsp,.sb3,.zip,.json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onUpload} />
          <Button type="button" variant="outline" size="sm" onClick={loadBuiltin}>Built-in program</Button>
          <Button type="button" variant="outline" size="sm" disabled={!project} onClick={downloadProgram}>Download JSON</Button>
          <span className="max-w-40 truncate text-xs text-muted-foreground" title={project?.project_name}>{project?.project_name}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">25 cm grid</span>
        </div>
        {uploadError && <p className="shrink-0 border-b px-3 py-1.5 text-xs text-destructive" role="alert">{uploadError}</p>}
        <div className="relative min-h-0 flex-1">
          <Canvas className="absolute inset-0" shadows camera={{ position: [0, 4, 0.001], fov: 42 }}><Suspense fallback={null}><Arena key={reset} config={config} view={view} controls={{ running, stepRequest, speed, halt: () => setRunning(false) }} runtime={runtime} mission={mission} zones={telemetry.mission?.zones ?? EMPTY_ZONES} openingIds={openingIds} inputIds={inputIds} report={setTelemetry} debug={false} /></Suspense></Canvas>
        </div>
      </div>
      {rightOpen && <aside id={showCode ? 'code-overlay' : 'variables-overlay'} className="flex min-h-0 flex-1 flex-col overflow-hidden border-t p-3 md:w-[28rem] md:shrink-0 md:flex-none md:border-t-0 md:border-l">
        {showCode
          ? <LiveCodeViewer program={project} execution={telemetry.execution} breakpoints={breakpoints} toggleBreakpoint={toggleBreakpoint} enabled={!!project} error={error || telemetry.error} />
          : <VariablesPanel program={project} values={telemetry.variables ?? runtime?.variables ?? {}} running={running} enabled={!!project} time={telemetry.time} />}
      </aside>}
    </div>
    <div className="shrink-0 border-t"><AreaStatus destination={destination} zones={telemetry.mission?.zones ?? EMPTY_ZONES} released={telemetry.mission?.cargo === 'released'} /><Transport {...transportProps} /></div>
  </div>
}
export default App
