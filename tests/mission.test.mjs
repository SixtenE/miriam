import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {DEFAULT_CONFIG,courseLayout} from '../src/arenaMath.ts'
import {CAN,CARGO_OFFSET,DeliveryMission,assessDelivery,inDeliveryArea,randomHeading,releaseBlockIds} from '../src/mission.ts'
import {castRobotMovement} from '../src/physicsQueries.ts'
import {EV3Runtime} from '../src/runtime.ts'
const config={...DEFAULT_CONFIG,yDistance:2.4}, m=courseLayout(config)
assert.equal(m.targetY.z-m.top,2.4);assert.equal(m.depth,3.4)
const atX={x:m.targetX.x,z:m.top+CAN.radius+.003,tilt:0,speed:0}
const atY={x:m.left+CAN.radius+.003,z:m.targetY.z,tilt:0,speed:0}
assert(assessDelivery(config,'X',atX).delivered)
assert(assessDelivery(config,'Y',atY).delivered)
assert(!assessDelivery(config,'Y',atX).delivered)
assert(!assessDelivery(config,'X',{...atX,x:atX.x+.51}).delivered)
assert(!assessDelivery(config,'X',{...atX,z:m.top+.3}).delivered) // Within zone, but away from wall.
assert(!assessDelivery(config,'X',{...atX,tilt:90}).delivered)
assert(!assessDelivery(config,'X',{...atX,speed:.1}).delivered)
assert(!assessDelivery(config,'X',{...atX,z:m.top-.1}).delivered)
assert(inDeliveryArea(config,'X',atX));assert(!inDeliveryArea(config,'Y',atX))
assert(inDeliveryArea(config,'Y',atY));assert(!inDeliveryArea(config,'X',atY))
assert(!inDeliveryArea(config,'X',{x:m.targetX.x,z:m.top-.2}))
assert(!inDeliveryArea(config,'Y',{x:m.left-.2,z:m.targetY.z}))
const yRun=new DeliveryMission(config,'Y')
assert.deepEqual(yRun.read().zones,{X:false,Y:false});assert.equal(yRun.read().placed,false)
yRun.observeCan(atX);assert.equal(yRun.read().zones.X,true);assert.equal(yRun.read().placed,false)
yRun.observeCan(atY);assert.equal(yRun.read().zones.Y,true);assert.equal(yRun.read().placed,true)
const xRun=new DeliveryMission(config,'X')
xRun.observeCan(atY);assert.equal(xRun.read().placed,false)
xRun.observeCan(atX);assert.equal(xRun.read().zones.X,true);assert.equal(xRun.read().placed,true)
const trial=new DeliveryMission(config,'X')
trial.tick(1/60,m.targetX.x,m.top+.251,0,0,true)
const pose=trial.release(m.targetX.x,m.top+.251,0)
assert(pose);assert(Math.abs(pose.z-(m.top+.251+CARGO_OFFSET))<1e-9);assert.equal(trial.release(0,0,0),null)
assert(trial.read().check.delivered)
for(let i=0;i<120;i++)trial.tick(1/60,m.targetX.x,m.top+.251,0,0,true)
assert(!trial.read().returned)
for(let i=0;i<120;i++)trial.tick(1/60,m.start.x,m.start.z,Math.PI,.1,false)
assert(!trial.read().returned)
for(let i=0;i<61;i++)trial.tick(1/60,m.start.x,m.start.z,Math.PI,0,true)
assert(trial.read().returned)
for(const heading of [0,Math.PI/2,Math.PI,Math.PI*1.5]) {
 const rear=new DeliveryMission(config,'X').release(0,0,heading)
 assert(Math.abs(rear.x-CARGO_OFFSET*Math.sin(heading))<1e-9)
 assert(Math.abs(rear.z-CARGO_OFFSET*Math.cos(heading))<1e-9)
}
const pausedTime=trial.read().elapsed
assert.equal(trial.read().elapsed,pausedTime)
trial.observeCan({...atX,tilt:90});trial.tick(1/60,m.start.x,m.start.z,Math.PI,0,true)
assert(!trial.read().returned)
assert.equal(randomHeading(()=>0),0);assert.equal(randomHeading(()=>.9999),359)
const program=JSON.parse(readFileSync(new URL('../public/finish_8.json',import.meta.url),'utf8'))
assert.equal(releaseBlockIds(program).size,1)
const ids=Object.fromEntries(program.targets.flatMap(t=>t.variables.map(v=>[v.name,v.id])))
// Both teacher choices must reach the corresponding imported path via touch edges.
for(const [destination,path,port] of [['X',2,3],['Y',1,2]]) {
 const engine=new EV3Runtime(program)
 engine.variables[ids.X]=0;engine.variables[ids.Y]=0
 const sensors={distance:25,angle:173,touch2:false,touch3:false}
 for(let i=0;i<30;i++)engine.tick(1/60,sensors)
 assert.equal(Number(engine.variables[ids.confirmed]),0)
 engine.tick(1/60,{...sensors,[`touch${port}`]:true})
 for(let i=0;i<700;i++)engine.tick(1/60,sensors)
 assert.equal(engine.error,'',destination)
 assert.equal(Number(engine.variables[ids.path]),path,destination)
}
// Release only when the imported opening command completes, not on function entry.
const sourceTarget=program.targets.find(t=>t.functions.some(f=>f.name==='drop off'))
const openingProgram={targets:[{variables:[],functions:sourceTarget.functions,scripts:[{script_id:'open',trigger:{block_id:'hat',opcode:'ev3events_whenProgramStarts'},steps:[{block_id:'call',opcode:'procedures_call',function_call:{name:'drop off',arguments:[]}}]}]}]}
const opening=new EV3Runtime(openingProgram), openingIds=releaseBlockIds(program)
let released=false
opening.subscribe(event=>{if(event.type==='block-complete' && openingIds.has(event.blockId))released=true})
const noTouch={distance:25,angle:0,touch2:false,touch3:false}
for(let i=0;i<60;i++)opening.tick(1/60,noTouch)
assert(!released)
for(let i=0;i<140;i++)opening.tick(1/60,noTouch)
assert(released)
const require=createRequire(import.meta.resolve('@react-three/rapier'))
const R=require('@dimforge/rapier3d-compat');await R.init()
const world=new R.World({x:0,y:-9.81,z:0})
const floor=world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0,-.06,0))
world.createCollider(R.ColliderDesc.cuboid(5,.06,5),floor)
const can=world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0,CAN.height/2+.002,0).setLinearDamping(2).setAngularDamping(2))
world.createCollider(R.ColliderDesc.cylinder(CAN.height/2,CAN.radius).setMass(CAN.mass).setFriction(.8).setRestitution(0),can)
for(let i=0;i<240;i++)world.step()
assert(Math.abs(can.mass()-CAN.mass)<1e-6)
assert(Math.abs(can.translation().y-CAN.height/2)<.003)
assert(Math.hypot(can.linvel().x,can.linvel().y,can.linvel().z)<.03)
assert(Math.abs(can.rotation().w)> .99)
world.free()
// A can dropped in the rear claw initially overlaps the simplified robot sphere.
// Forward must separate from it; reversing into it and approaching walls must stop.
const contacts=new R.World({x:0,y:0,z:0})
const cargo=contacts.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0,CAN.height/2+.002,CARGO_OFFSET))
contacts.createCollider(R.ColliderDesc.cylinder(CAN.height/2,CAN.radius).setMass(CAN.mass),cargo)
const wall=contacts.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0,.15,1.03))
contacts.createCollider(R.ColliderDesc.cuboid(1,.15,.03),wall)
contacts.step()
const identity={x:0,y:0,z:0,w:1}, position={x:0,y:.24,z:0}
assert(contacts.castShape(position,identity,{x:0,y:0,z:.2},new R.Ball(.25),.001,1/60,true))
assert.equal(castRobotMovement(contacts,R,position,identity,{x:0,y:0,z:.2},1/60),null)
assert(castRobotMovement(contacts,R,position,identity,{x:0,y:0,z:-.2},1/60))
const forwardHit=castRobotMovement(contacts,R,position,identity,{x:0,y:0,z:.2},5)
assert(forwardHit);assert(Math.abs(forwardHit.time_of_impact-3.745)<.02)
// Repeat for each compass heading so this also covers randomized mission starts.
for(const angle of [Math.PI/2,Math.PI,Math.PI*1.5]) {
 const direction={x:Math.sin(angle),y:0,z:Math.cos(angle)}
 cargo.setTranslation({x:CARGO_OFFSET*direction.x,y:CAN.height/2+.002,z:CARGO_OFFSET*direction.z},true)
 cargo.setLinvel({x:0,y:0,z:0},true)
 contacts.step()
 const rotation={x:0,y:Math.sin(angle/2),z:0,w:Math.cos(angle/2)}
 assert.equal(castRobotMovement(contacts,R,position,rotation,direction,1/60),null)
 assert(castRobotMovement(contacts,R,position,rotation,{x:-direction.x,y:0,z:-direction.z},1/60))
}
contacts.free()
console.log('PASS: both delivery targets; longer Y placement; wrong zone, wall gap, tipping and motion rejection; release and return; randomized headings; imported X/Y touch selection; physical can mass and stable resting pose.')
