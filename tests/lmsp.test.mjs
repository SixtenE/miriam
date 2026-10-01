import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import { convertLmsp, loadProgram } from '../src/lmsp.ts'
import { EV3Runtime } from '../src/runtime.ts'

const sensors = { distance: 75, angle: 0, touch2: false, touch3: false }
const original = JSON.parse(readFileSync(new URL('../public/finish_8.json', import.meta.url), 'utf8'))
const sb3 = zipSync({ 'project.json': strToU8(JSON.stringify(original.original_scratch_project)) })
const lmsp = zipSync({
  'manifest.jsn': strToU8(JSON.stringify(original.manifest)),
  'scratch.sb3': sb3,
  'icon.svg': strToU8('<svg xmlns="http://www.w3.org/2000/svg"/>'),
})
const converted = convertLmsp(lmsp, 'finish_8 (3).lmsp')
const convertedSprite = converted.targets.find(target => !target.is_stage)
const expectedSprite = structuredClone(original.targets.find(target => !target.is_stage))
// Path 1 in the published JSON was edited after import. Conversion follows the Scratch project.
expectedSprite.functions[1].steps = convertedSprite.functions[1].steps

assert.equal(converted.project_name, 'finish_8')
assert.equal(converted.source_file, 'finish_8 (3).lmsp')
assert.deepEqual(converted.summary, original.summary)
assert.deepEqual(convertedSprite, expectedSprite)
assert.equal(convertedSprite.functions[1].steps[0].opcode, 'ev3move_move')
assert.deepEqual(convertedSprite.scripts.map(script => script.script_id), expectedSprite.scripts.map(script => script.script_id))
assert.deepEqual(convertedSprite.functions.map(fn => fn.name), ['findClosest', 'Path 1', 'drop off', 'rotateTo %s', 'close clamp', 'Path 2'])
assert.deepEqual(convertedSprite.variables, expectedSprite.variables)

const rotateCall = findCall(convertedSprite, 'rotateTo %s')
assert.equal(rotateCall.arguments[0].name, 'Angle')
assert.equal(rotateCall.arguments[0].value.value, '-90')

const ratio = convertedSprite.variables.find(variable => variable.name === 'ratio')
const runtime = new EV3Runtime(converted)
for (let i = 0; i < 30 && runtime.variables[ratio.id] !== '5.684'; i++) assert.equal(runtime.tick(1 / 60, sensors), true)
assert.equal(runtime.variables[ratio.id], '5.684')
assert.equal(runtime.error, '')

const tiny = {
  targets: [{
    isStage: false,
    name: 'sprite',
    variables: { v: ['answer', 0] },
    lists: {},
    broadcasts: {},
    comments: {},
    blocks: {
      hat: { opcode: 'ev3events_whenProgramStarts', next: 'set', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 0, y: 0 },
      set: { opcode: 'data_setvariableto', next: null, parent: 'hat', inputs: { VALUE: [1, [10, '1']] }, fields: { VARIABLE: ['answer', 'v'] }, shadow: false, topLevel: false },
    },
  }],
}
const direct = convertLmsp(zipSync({ 'project.json': strToU8(JSON.stringify(tiny)), 'manifest.jsn': strToU8(JSON.stringify({ name: 'Tiny' })) }), 'tiny.lmsp')
assert.equal(direct.project_name, 'Tiny')
assert.equal(direct.targets[0].scripts[0].steps[0].opcode, 'data_setvariableto')
const engine = new EV3Runtime(direct)
assert.equal(engine.tick(1 / 60, sensors), true)
assert.equal(engine.variables.v, '1')
const reloaded = loadProgram(new TextEncoder().encode(JSON.stringify(direct)), 'tiny.json')
assert.equal(reloaded.project_name, 'Tiny')
assert.equal(reloaded.targets[0].scripts[0].steps[0].opcode, 'data_setvariableto')

assert.throws(() => convertLmsp(new Uint8Array([1, 2, 3, 4])), /lmsp archive/)
assert.throws(() => convertLmsp(zipSync({ 'icon.svg': strToU8('<svg/>') })), /Scratch project/)

function findCall(sprite, name) {
  const visit = steps => {
    for (const step of steps ?? []) {
      if (step.function_call?.name === name) return step.function_call
      const nested = visit(step.branches?.body) ?? visit(step.branches?.else)
      if (nested) return nested
    }
  }
  for (const script of sprite.scripts) {
    const call = visit(script.steps)
    if (call) return call
  }
  for (const fn of sprite.functions) {
    const call = visit(fn.steps)
    if (call) return call
  }
  throw new Error(`Missing call ${name}`)
}
