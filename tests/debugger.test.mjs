import assert from 'node:assert/strict'
import { EV3Runtime } from '../src/runtime.ts'
const dt = 1 / 60
const sensors = { distance: 75, angle: 0, touch2: false, touch3: false }
const literal = value => ({ kind: 'number', value })
const block = (id, opcode, inputs = {}, fields = {}, extra = {}) => ({ block_id: id, opcode, inputs: Object.fromEntries(Object.entries(inputs).map(([k,v]) => [k,{value: typeof v === 'object' ? v : literal(v)}])), fields: Object.fromEntries(Object.entries(fields).map(([k,v]) => [k,{value:v,reference_id:k === 'VARIABLE' ? v : undefined}])), ...extra })
const start = (id, steps) => ({ script_id: id, trigger: block(`${id}-hat`, 'ev3events_whenProgramStarts'), steps })
const project = (scripts, functions = []) => ({ targets: [{ variables: [], scripts, functions }] })
const setter = (id, key, value) => block(id, 'data_setvariableto', {VALUE:value}, {VARIABLE:key})
const runUntil = (runtime, condition, max = 100) => { for(let i = 0; i < max && !condition(); i++) runtime.tick(dt,sensors); assert(condition()) }

const stopped = new EV3Runtime(project([start('main',[setter('set-value','answer',42)])]))
stopped.setBreakpoints(['set-value'])
assert.equal(stopped.tick(dt,sensors),false)
assert.equal(stopped.time,0); assert.equal(stopped.variables.answer,undefined)
assert.equal(stopped.snapshot().scripts[0].status,'breakpoint')
assert.equal(stopped.snapshot().events.some(e => e.type === 'block-enter' && e.blockId === 'set-value'),false)
assert.equal(stopped.tick(dt,sensors),false); assert.equal(stopped.time,0)
stopped.resume(); assert.equal(stopped.tick(dt,sensors),true)
assert.equal(stopped.variables.answer,42); assert.equal(stopped.time,dt)
const completed = stopped.snapshot().events.find(e => e.type === 'block-complete')
assert.equal(completed.blockId,'set-value'); assert.equal(completed.scriptId,'main'); assert.equal(completed.instant,true)
assert.equal(stopped.snapshot().scripts[0].status,'finished')
assert(stopped.snapshot().events.some(e => e.type === 'script-stop' && e.scriptId === 'main'))

const move = new EV3Runtime(project([start('drive',[block('movement','ev3move_move',{VALUE:.1},{DIRECTION:'forward',UNIT:'rotations'}),setter('after','moved',1)])]))
move.tick(dt,sensors)
assert.equal(move.snapshot().scripts[0].status,'waiting')
assert.equal(move.snapshot().scripts[0].reason,'movement')
assert.equal(move.snapshot().inspections['drive:movement'].inputs.VALUE,.1)
for(let i=0;i<3;i++) move.tick(dt,sensors)
assert(move.snapshot().scripts[0].progress.completedRotations>0)
runUntil(move,()=>move.variables.moved===1)
assert.equal(move.snapshot().events.filter(e=>e.type==='block-wait' && e.blockId==='movement').length,1)
assert(move.snapshot().inspections['drive:movement'].progress.completedRotations>=.1)
assert.equal(move.snapshot().inspections['drive:movement'].status,'finished')
assert.deepEqual(move.wheels,[0,0])

const condition = {kind:'block', opcode:'operator_equals', inputs:{OPERAND1:{value:{kind:'variable',reference_id:'done',value:'done'}},OPERAND2:{value:literal(1)}}}
const nested = new EV3Runtime(project([start('nested',[block('loop','control_repeat_until',{CONDITION:condition},{},{branches:{body:[block('call','procedures_call',{},{},{function_call:{name:'do work',arguments:[]}})]}})])],[{name:'do work',steps:[setter('inside','done',1)]}]))
nested.setBreakpoints(['inside'])
runUntil(nested,()=>!!nested.breakpoint)
assert.equal(nested.variables.done,undefined)
assert.deepEqual(nested.snapshot().scripts[0].ancestors,['loop','call'])
const before = nested.time
assert(nested.tick(dt,sensors,true)); assert.equal(nested.time,before+dt)
assert.equal(nested.variables.done,1)
runUntil(nested,()=>nested.threadCount===0)
const order = nested.snapshot().events
assert(order.findIndex(e=>e.type==='block-complete'&&e.blockId==='call')>order.findIndex(e=>e.type==='block-complete'&&e.blockId==='inside'))

const argument = {kind:'block',opcode:'argument_reporter_string_number',fields:{VALUE:{value:'seconds'}}}
const call = (id, value) => block(id,'procedures_call',{},{},{function_call:{name:'wait %s',arguments:[{name:'seconds',value:literal(value)}]}})
const parallel = new EV3Runtime(project([start('one',[call('call-one',10)]),start('two',[call('call-two',20)])],[{name:'wait %s',steps:[block('shared-wait','control_wait',{DURATION:argument})]}]))
for(let i=0;i<4;i++)parallel.tick(dt,sensors)
assert.equal(parallel.snapshot().scripts.filter(s=>s.status==='waiting').length,2)
assert.equal(parallel.snapshot().inspections['one:shared-wait'].inputs.DURATION,10)
assert.equal(parallel.snapshot().inspections['two:shared-wait'].inputs.DURATION,20)
assert.deepEqual(parallel.snapshot().scripts.map(s=>s.ancestors),[['call-one'],['call-two']])
const stable = parallel.snapshot()
assert.equal(parallel.snapshot().time,stable.time)
assert.deepEqual(parallel.snapshot().scripts,stable.scripts)
let delivered = []
const unsubscribe = parallel.subscribe(event=>delivered.push(event))
for(let i=0;i<1300;i++)parallel.tick(dt,sensors)
assert(delivered.some(e=>e.type==='block-complete')); assert(delivered.some(e=>e.type==='script-stop'))
unsubscribe(); const eventCount=delivered.length; parallel.tick(dt,sensors); assert.equal(delivered.length,eventCount)

const interrupted = new EV3Runtime(project([start('waiter',[block('wait','control_wait',{DURATION:5})]),start('stopper',[block('stop','ev3control_stopOtherStacks')])]))
interrupted.tick(dt,sensors)
assert.equal(interrupted.snapshot().scripts.find(s=>s.scriptId==='waiter').status,'finished')
assert(interrupted.snapshot().events.some(e=>e.type==='script-stop'&&e.scriptId==='waiter'&&e.reason==='stopped by another script'))
assert(!interrupted.snapshot().events.some(e=>e.type==='block-complete'&&e.blockId==='wait'))

const port = value => ({ kind: 'menu', opcode: 'ev3move_menu_outputPort', fields: { outputPort: { value } } })
const wheel = value => ({ kind: 'menu', opcode: 'ev3move_rotation-wheel', fields: { 'field_ev3move_rotation-wheel': { value } } })
const spin = new EV3Runtime(project([start('spin', [
  block('pair', 'ev3move_setMovementPair', { LEFT_PORT: port('1'), RIGHT_PORT: port('4') }),
  block('steer', 'ev3move_startSteer', { STEERING: wheel(100) }),
])]))
runUntil(spin, () => spin.threadCount === 0)
assert.equal(spin.error, '')
assert.deepEqual(spin.wheels, [50, -50])
const straight = new EV3Runtime(project([start('straight', [block('steer', 'ev3move_startSteer', { STEERING: wheel(0) })])]))
runUntil(straight, () => straight.threadCount === 0)
assert.deepEqual(straight.wheels, [50, 50])
console.log('PASS: pre-execution breakpoints, exact single-tick stepping, event order, instant completion, persistent movement waits and progress, nested call/loop context, parallel function inspection, event subscriptions, interrupted script status, and move steering.')
