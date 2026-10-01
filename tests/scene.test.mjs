import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {EV3Runtime, compare} from '../src/runtime.ts'
import {wallDistance, DEFAULT_CONFIG, courseLayout, MAX_RANGE} from '../src/arenaMath.ts'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.resolve('@react-three/rapier'))
const R = require('@dimforge/rapier3d-compat')
const sensors={distance:75,angle:0,touch2:false,touch3:false}
const literal=value=>({kind:'number',value})
const block=(id,opcode,inputs={},fields={},extra={})=>({block_id:id,opcode,inputs:Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,{value:typeof v==='object'?v:literal(v)}])),fields:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,{value:v,reference_id:k==='VARIABLE'?v:undefined}])),...extra})
const start=steps=>({script_id:'main',trigger:block('hat','ev3events_whenProgramStarts'),steps})
const message=(name,steps)=>({script_id:name,trigger:block(name+'-hat','event_whenbroadcastreceived',{}, {BROADCAST_OPTION:name}),steps})
const project=(scripts,functions=[])=>({targets:[{variables:[],scripts,functions}]})
const map=courseLayout(DEFAULT_CONFIG)
assert.equal(map.width,5);assert.equal(map.depth,2)
assert.deepEqual(map.start,{x:-.5,z:-.5})
assert.equal(map.targetX.x-map.start.x,2);assert.equal(map.targetY.z-map.top,1)
assert.equal(map.left+map.width-map.targetX.x,1);assert.equal(map.top+map.depth-map.targetY.z,1)
assert.equal(wallDistance(map.start.x,map.start.z,Math.PI,DEFAULT_CONFIG),.25)
assert(Math.abs(wallDistance(map.start.x,map.start.z,Math.PI*1.5,DEFAULT_CONFIG)-1.75)<1e-8)
for(const angle of [0,Math.PI/2])assert.equal(wallDistance(map.start.x,map.start.z,angle,DEFAULT_CONFIG),MAX_RANGE)
for(const startX of [1,3])for(const startWallDistance of [.25,.75]) {
 const config={...DEFAULT_CONFIG,startX,startWallDistance}, m=courseLayout(config)
 assert.equal(m.start.x-m.left,startX);assert.equal(m.start.z-m.top,startWallDistance)
 assert.equal(m.targetX.x-m.start.x,2)
 assert.equal(wallDistance(m.start.x,m.start.z,Math.PI,config),startWallDistance-config.sensorOffset)
}
// Rays beyond the finite wall endpoints see open space.
assert.equal(wallDistance(map.left+map.width+1,0,Math.PI,DEFAULT_CONFIG),MAX_RANGE)
assert.equal(wallDistance(0,map.top+map.depth+1,Math.PI*1.5,DEFAULT_CONFIG),MAX_RANGE)
assert(compare(10,20,'4'));assert(compare(20,10,'2'));assert(!compare(20,10,'4'))
const run=new EV3Runtime(project([start([block('wait','control_wait',{DURATION:.5}),block('done','data_setvariableto',{VALUE:1},{VARIABLE:'done'})])]))
run.tick(1/60,sensors)
for(let i=0;i<25;i++)run.tick(1/60,sensors)
assert.equal(run.variables.done,undefined)
for(let i=0;i<10;i++)run.tick(1/60,sensors)
assert.equal(run.variables.done,1)
const parallel=new EV3Runtime(project([start([block('broadcast','event_broadcastandwait',{BROADCAST_INPUT:'child'}),block('parentdone','data_setvariableto',{VALUE:1},{VARIABLE:'parent'})]),message('child',[block('childwait','control_wait',{DURATION:.3}),block('childdone','data_setvariableto',{VALUE:1},{VARIABLE:'child'})])]))
for(let i=0;i<12;i++)parallel.tick(1/60,sensors)
assert.equal(parallel.variables.parent,undefined)
for(let i=0;i<20;i++)parallel.tick(1/60,sensors)
assert.equal(parallel.variables.child,1);assert.equal(parallel.variables.parent,1)
const angleReporter={kind:'block',opcode:'argument_reporter_string_number',fields:{VALUE:{value:'Angle'}}}
const func=new EV3Runtime(project([start([block('call','procedures_call',{}, {},{function_call:{name:'rotate %s',arguments:[{name:'Angle',value:literal(90)}]}})])],[{name:'rotate %s',steps:[block('argset','data_setvariableto',{VALUE:angleReporter},{VARIABLE:'angle'})]}]))
for(let i=0;i<5;i++)func.tick(1/60,sensors)
assert.equal(func.variables.angle,90)
const waitTouch=new EV3Runtime(project([start([block('touchwait','ev3sensors_waitEV3TouchSensorTouch',{PORT:{kind:'menu',opcode:'ev3sensors_menu_inputPort',fields:{inputPort:{value:'2'}}}},{EVENT:'1'}),block('touchdone','data_setvariableto',{VALUE:1},{VARIABLE:'t'})])]))
for(let i=0;i<20;i++)waitTouch.tick(1/60,sensors)
assert(waitTouch.active.includes('touchwait'));assert.equal(waitTouch.variables.t,undefined)
for(let i=0;i<4;i++)waitTouch.tick(1/60,{...sensors,touch2:true})
assert.equal(waitTouch.variables.t,1)
const real=new EV3Runtime(JSON.parse(readFileSync(new URL('../public/finish_8.json', import.meta.url),'utf8')))
for(let i=0;i<500;i++)real.tick(1/60,sensors)
assert.equal(real.error,'');assert(real.active.length>0)
const movement=new EV3Runtime(project([start([block('move','ev3move_move',{VALUE:.1},{DIRECTION:'forward',UNIT:'rotations'}),block('moved','data_setvariableto',{VALUE:1},{VARIABLE:'moved'})])]))
movement.tick(1/60,sensors);assert.deepEqual(movement.wheels,[50,50]);assert(movement.active.includes('move'))
for(let i=0;i<30;i++)movement.tick(1/60,sensors)
assert.deepEqual(movement.wheels,[0,0]);assert.equal(movement.variables.moved,1)
const unsupported=new EV3Runtime(project([start([block('bad','unknown_command')])]))
unsupported.tick(1/60,sensors);assert(unsupported.error.includes('Unsupported command'));assert.deepEqual(unsupported.wheels,[0,0])
await R.init()
const world=new R.World({x:0,y:-9.81,z:0})
for(const [x,y,z,hx,hy,hz] of [[0,-.06,0,1.06,.06,1.06],[-1.03,.15,0,.03,.15,1.06],[1.03,.15,0,.03,.15,1.06],[0,.15,-1.03,1,.15,.03],[0,.15,1.03,1,.15,.03]]) {
 const body=world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x,y,z))
 world.createCollider(R.ColliderDesc.cuboid(hx,hy,hz),body)
}
world.step()
for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]){
 const direction={x:Math.sin(angle),y:0,z:Math.cos(angle)}
 const ray=world.castRay(new R.Ray({x:direction.x*.25,y:.15,z:direction.z*.25},direction),2.55,true)
 assert(Math.abs(ray.timeOfImpact-.75)<1e-5)
 const hit=world.castShape({x:0,y:.24,z:0},{x:0,y:Math.sin(angle/2),z:0,w:Math.cos(angle/2)},direction,new R.Ball(.25),.001,2,true,undefined,undefined,undefined,undefined,c=>c.translation().y>.05)
 assert(hit);assert(Math.abs(hit.time_of_impact-.749)<.003)
 const stopped={x:direction.x*(hit.time_of_impact-.0001),y:.15,z:direction.z*(hit.time_of_impact-.0001)}
 const q={x:0,y:Math.sin(angle/2),z:0,w:Math.cos(angle/2)}
 // Upward-facing buttons sit above the wall and do not become front bumpers.
 for(const side of [-.09,.09]) {
  const pos={x:stopped.x+side*Math.cos(angle)+.12*direction.x,y:.39,z:stopped.z-side*Math.sin(angle)+.12*direction.z}
  assert.equal(world.intersectionWithShape(pos,q,new R.Cuboid(.025,.009,.025)),null)
 }
}
world.free()
const course=new R.World({x:0,y:-9.81,z:0})
for(const [x,y,z,hx,hy,hz] of [[0,-.06,.25,map.floorWidth/2,.06,map.floorDepth/2],[0,.15,map.top-.03,(map.width+.06)/2,.15,.03],[map.left-.03,.15,0,.03,.15,(map.depth+.06)/2]]) {
 const body=course.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x,y,z))
 course.createCollider(R.ColliderDesc.cuboid(hx,hy,hz),body)
}
course.step()
for(const [angle,expected] of [[Math.PI,.25],[Math.PI*1.5,1.75],[0,null],[Math.PI/2,null]]) {
 const direction={x:Math.sin(angle),y:0,z:Math.cos(angle)}
 const ray=course.castRay(new R.Ray({x:map.start.x+direction.x*.25,y:.15,z:map.start.z+direction.z*.25},direction),MAX_RANGE,true)
 if(expected===null)assert.equal(ray,null)
 else assert(Math.abs(ray.timeOfImpact-expected)<1e-5)
 const sweep=course.castShape({x:map.start.x,y:.24,z:map.start.z},{x:0,y:0,z:0,w:1},direction,new R.Ball(.25),.001,4,true,undefined,undefined,undefined,undefined,c=>c.translation().y>.05)
 if(expected===null)assert.equal(sweep,null)
 else {assert(sweep);assert(Math.abs(sweep.time_of_impact-(expected-.001))<.003)}
}
course.free()
console.log('PASS: map dimensions and configurable Start; finite walls and open sides; fixed-clock waits; broadcasts; functions; touch waits; imported startup; Rapier rays, sweeps, and contact areas.')
