import type { Block, Expression, Script } from './runtime'

export function expression(exp?: Expression): string {
  if (!exp) return ''
  if (!exp.opcode) return String(exp.value ?? '')
  if (exp.kind === 'menu') return String(Object.values(exp.fields ?? {})[0]?.value ?? '')
  if (exp.opcode === 'argument_reporter_string_number') return String(exp.fields?.VALUE.value ?? '')
  const symbols: Record<string, string> = { operator_add: '+', operator_subtract: '−', operator_multiply: '×', operator_divide: '÷', operator_mod: 'mod', operator_equals: '=', operator_lt: '<', operator_gt: '>', operator_and: 'and', operator_or: 'or' }
  if (symbols[exp.opcode]) return `(${expression(exp.inputs?.NUM1?.value ?? exp.inputs?.OPERAND1?.value)} ${symbols[exp.opcode]} ${expression(exp.inputs?.NUM2?.value ?? exp.inputs?.OPERAND2?.value)})`
  if (exp.opcode === 'operator_not') return `not ${expression(exp.inputs?.OPERAND.value)}`
  if (exp.opcode === 'ev3sensors_isEV3UltrasonicSensorDistance') return `distance ${({'0':'=','1':'≠','2':'>','3':'≥','4':'<','5':'≤'} as Record<string,string>)[String(exp.fields?.COMPARATOR.value)]} ${expression(exp.inputs?.VALUE.value)} ${exp.fields?.UNIT.value ?? ''}`
  if (exp.opcode.includes('Gyro')) return 'gyro angle'
  if (exp.opcode.includes('Ultrasonic')) return 'distance'
  if (exp.opcode.includes('Touch')) return `touch ${expression(exp.inputs?.PORT.value)} pressed`
  return exp.opcode.replace(/^operator_/, '')
}
export function blockLabel(b: Block): string {
  if (b.function_call) return `Call ${b.function_call.name.replace('%s', b.function_call.arguments.map(a => expression(a.value)).join(', '))}`
  const op = b.opcode
  if (op === 'data_setvariableto' || op === 'data_changevariableby') return `${op.includes('change') ? 'Change' : 'Set'} ${b.fields?.VARIABLE.value} ${op.includes('change') ? 'by' : 'to'} ${expression(b.inputs?.VALUE.value)}`
  if (op === 'control_wait_until') return `Wait until ${expression(b.inputs?.CONDITION.value)}`
  if (op === 'control_repeat_until') return `Repeat until ${expression(b.inputs?.CONDITION.value)}`
  if (op === 'control_if' || op === 'control_if_else') return `If ${expression(b.inputs?.CONDITION.value)}`
  if (op === 'control_wait') return `Wait ${expression(b.inputs?.DURATION.value)} seconds`
  if (op === 'ev3move_move') return `Move ${b.fields?.DIRECTION.value} ${expression(b.inputs?.VALUE.value)} ${b.fields?.UNIT.value}`
  if (op === 'ev3move_startSteer') return `Start moving with steering ${expression(b.inputs?.STEERING.value)}`
  if (op === 'ev3motor_motorStartSpeed') return `Motor ${expression(b.inputs?.PORT.value)}: ${expression(b.inputs?.SPEED.value)}%`
  if (op === 'ev3sensors_waitEV3TouchSensorTouch') return `Wait for touch ${expression(b.inputs?.PORT.value)} ${b.fields?.EVENT.value === '1' ? 'pressed' : 'released'}`
  if (op === 'ev3sensors_waitEV3GyroSensorAngle') return `Wait for gyro angle: ${expression(b.inputs?.VALUE.value)}`
  if (op.startsWith('event_broadcast')) return `Broadcast “${expression(b.inputs?.BROADCAST_INPUT.value)}”${op.endsWith('andwait') ? ' and wait' : ''}`
  return op.replace(/^(ev3\w+|control|data|event)_/, '').replace(/([A-Z])/g, ' $1')
}
export function scriptLabel(s: Script): string {
  if (s.trigger.opcode.includes('ProgramStarts')) return 'When program starts'
  if (s.trigger.opcode.includes('Touch')) return `Touch ${expression(s.trigger.inputs?.PORT.value)} ${s.trigger.fields?.EVENT.value === '1' ? 'pressed' : 'released'}`
  return `When “${s.trigger.fields?.BROADCAST_OPTION.value}” received`
}
