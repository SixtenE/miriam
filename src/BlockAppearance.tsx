import { cn } from 'cn'
import type { Block, Expression } from './runtime'
import { blockLabel, expression } from './codeLabels'
import { blockCategory } from './blockCategories'

const reporterTone: Record<string, string> = {
  operator: 'bg-[#00af53]',
  sensor: 'bg-[#00b8d9]',
  variable: 'bg-[#ff8c1a]',
  function: 'bg-[#ff5075]',
  motor: 'bg-[#008cf0]',
}

const slot = 'inline-flex max-w-full items-center rounded-md px-1.5 py-0.5 align-middle text-[11px] leading-4 font-medium'
const reporter = 'inline-flex max-w-full flex-wrap items-center gap-1 rounded-md px-1.5 py-0.5 align-middle text-[11px] leading-4 text-white'

function Input({ value }: { value?: Expression }) {
  if (!value) return null
  if (!value.opcode || value.kind === 'menu') return <span className={cn(slot, 'bg-background text-neutral-800 ring-1 ring-black/10', value.kind === 'variable' && 'bg-[#ff8c1a] font-semibold text-white ring-0')}>{expression(value)}</span>
  const symbols: Record<string, string> = { operator_add: '+', operator_subtract: '−', operator_multiply: '×', operator_divide: '÷', operator_mod: 'mod', operator_equals: '=', operator_lt: '<', operator_gt: '>', operator_and: 'and', operator_or: 'or' }
  const word = symbols[value.opcode]
  if (word === 'and' || word === 'or') return <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 align-middle"><Input value={value.inputs?.NUM1?.value ?? value.inputs?.OPERAND1?.value} /><span className="text-xs font-semibold text-[#009449]">{word}</span><Input value={value.inputs?.NUM2?.value ?? value.inputs?.OPERAND2?.value} /></span>
  if (word) return <span className={cn(reporter, 'bg-[#00af53]')}><Input value={value.inputs?.NUM1?.value ?? value.inputs?.OPERAND1?.value} />{word}<Input value={value.inputs?.NUM2?.value ?? value.inputs?.OPERAND2?.value} /></span>
  if (value.opcode === 'operator_not') return <span className="inline-flex max-w-full flex-wrap items-center gap-1 align-middle"><span className="text-xs font-semibold text-[#009449]">not</span><Input value={value.inputs?.OPERAND?.value} /></span>
  if (value.opcode === 'ev3sensors_isEV3UltrasonicSensorDistance') return <span className={cn(reporter, 'bg-[#00af53]')}><span className="rounded-md bg-[#00b8d9] px-1.5">distance {expression(value.inputs?.PORT?.value)}</span>{({ '0': '=', '1': '≠', '2': '>', '3': '≥', '4': '<', '5': '≤' } as Record<string, string>)[String(value.fields?.COMPARATOR.value)]}<Input value={value.inputs?.VALUE?.value} />{value.fields?.UNIT.value}</span>
  const category = blockCategory({ opcode: value.opcode })
  return <span className={cn(reporter, reporterTone[category] ?? 'bg-neutral-500')}>{expression(value)}</span>
}

const portLabel = (value?: Expression) => ({ '1': 'A', '2': 'B', '3': 'C', '4': 'D' }[expression(value)] ?? expression(value))

function Menu({ children }: { children: string }) {
  return <span className={cn(slot, 'bg-foreground/5 font-semibold text-foreground ring-1 ring-foreground/10')}>{children}</span>
}

function VariableName({ children }: { children: string }) {
  return <span className={cn(slot, 'bg-[#ff8c1a] font-semibold text-white')}>{children}</span>
}

export function BlockContents({ block: b }: { block: Block }) {
  const input = (key: string) => <Input value={b.inputs?.[key]?.value} />
  const field = (key: string) => String(b.fields?.[key]?.value ?? '')
  const port = <Menu>{portLabel(b.inputs?.PORT?.value)}</Menu>
  if (b.function_call) return <>{b.function_call.name.split('%s').map((part, i) => <span key={i}>{part}{b.function_call!.arguments[i] && <Input value={b.function_call!.arguments[i].value} />}</span>)}</>
  switch (b.opcode) {
    case 'data_setvariableto': return <>set <VariableName>{field('VARIABLE')}</VariableName> to {input('VALUE')}</>
    case 'data_changevariableby': return <>change <VariableName>{field('VARIABLE')}</VariableName> by {input('VALUE')}</>
    case 'control_wait': return <>wait {input('DURATION')} seconds</>
    case 'control_wait_until': return <>wait until {input('CONDITION')}</>
    case 'control_repeat_until': return <>repeat until {input('CONDITION')}</>
    case 'control_repeat': return <>repeat {input('TIMES')} times</>
    case 'control_if': case 'control_if_else': return <>if {input('CONDITION')}</>
    case 'control_forever': return <>forever</>
    case 'ev3move_move': return <>move <Menu>{field('DIRECTION')}</Menu> for {input('VALUE')} <Menu>{field('UNIT')}</Menu></>
    case 'ev3sound_setVolumeTo': return <>set volume to {input('VOLUME')} %</>
    case 'ev3move_moveSetStopAction': return <>set movement stop action <Menu>{field('OPTION')}</Menu></>
    case 'ev3move_movementSpeed': return <>set movement speed to {input('SPEED')} %</>
    case 'ev3move_setMovementPair': return <>set movement motors to <Menu>{portLabel(b.inputs?.LEFT_PORT?.value)}</Menu> and <Menu>{portLabel(b.inputs?.RIGHT_PORT?.value)}</Menu></>
    case 'ev3move_startSteer': return <>start moving with steering {input('STEERING')}</>
    case 'ev3motor_motorStartSpeed': return <>{port} start motor at {input('SPEED')} % speed</>
    case 'ev3motor_motorStart': return <>{port} start motor <Menu>{field('DIRECTION')}</Menu></>
    case 'ev3motor_motorSetSpeed': return <>{port} set speed to {input('SPEED')} %</>
    case 'ev3motor_motorTurnFor': return <>{port} run <Menu>{field('DIRECTION')}</Menu> for {input('VALUE')} <Menu>{field('UNIT')}</Menu></>
    case 'ev3motor_motorStop': return <>{port} stop motor</>
    case 'ev3motor_motorSetStopAction': return <>{port} set stop action {input('OPTION')}{field('OPTION')}</>
    case 'ev3sensors_resetEV3GyroSensorAngle': return <>reset gyro <Menu>{expression(b.inputs?.PORT?.value)}</Menu> angle</>
    case 'ev3sensors_waitEV3TouchSensorTouch': return <>wait for touch <Menu>{expression(b.inputs?.PORT?.value)}</Menu> <Menu>{field('EVENT') === '1' ? 'pressed' : 'released'}</Menu></>
    case 'ev3sensors_waitEV3GyroSensorAngle': return <>wait for gyro angle {input('VALUE')}</>
    case 'event_broadcast': case 'event_broadcastandwait': return <>broadcast {input('BROADCAST_INPUT')}{b.opcode.endsWith('andwait') ? ' and wait' : ''}</>
    case 'ev3sound_playSound': case 'ev3sound_playSoundUntilDone': return <>play sound <Menu>{field('SOUND')}</Menu>{b.opcode.endsWith('UntilDone') ? ' until done' : ''}</>
    default: return <>{blockLabel(b)}{Object.entries(b.inputs ?? {}).map(([key, value]) => <span className="text-xs" key={key}> {key.toLowerCase().replaceAll('_', ' ')} <Input value={value.value} /></span>)}</>
  }
}
