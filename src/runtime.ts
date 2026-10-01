export type Value = string | number | boolean
export type Expression = { kind?: string; value?: Value; reference_id?: string | null; opcode?: string; block_id?: string; fields?: Record<string, { value: Value; reference_id?: string | null }>; inputs?: Record<string, { value: Expression }> }
export type Block = Expression & { block_id: string; opcode: string; branches?: Record<string, Block[]>; function_call?: { name: string; arguments: { id?: string; name: string; value: Expression }[] } }
export type Script = { script_id: string; trigger: Block; steps: Block[] }
export type Program = { project_name: string; summary: { source_blocks: number }; targets: { variables: { id: string; name: string; saved_value: Value }[]; scripts: Script[]; functions: { name: string; steps: Block[] }[] }[] }
export type Sensors = { distance: number; angle: number; touch2: boolean; touch3: boolean }
export type ExecutionStatus = 'idle' | 'running' | 'waiting' | 'finished' | 'breakpoint' | 'error'
export type ExecutionEvent = { sequence: number; type: 'block-enter' | 'block-wait' | 'block-complete' | 'script-stop'; scriptId: string; runId: number; blockId: string | null; time: number; wallTime: number; reason?: string; instant?: boolean; ancestors: string[] }
export type BlockInspection = { blockId: string; scriptId: string; inputs: Record<string, Value>; fields: Record<string, Value>; progress: Record<string, Value>; status: ExecutionStatus; ancestors: string[] }
export type ScriptExecution = { scriptId: string; runId?: number; blockId: string | null; status: ExecutionStatus; reason?: string; ancestors: string[]; progress: Record<string, Value> }
export type ExecutionSnapshot = { time: number; scripts: ScriptExecution[]; events: ExecutionEvent[]; inspections: Record<string, BlockInspection>; breakpoint: { scriptId: string; blockId: string } | null; error: string }
type Context = { block: Block; locals: Record<string, Value>; ancestors: string[] }
type Token = Context & { kind: 'before' | 'running' | 'waiting' | 'complete'; reason?: string; progress: Record<string, Value> }
type Thread = { id: number; script: string; generator: Generator<Token, void>; pending?: Token; status: ExecutionStatus }
const number = (v: Value): number => Number(v) || 0
const truth = (v: Value): boolean => typeof v === 'boolean' ? v : v !== '' && v !== '0' && v !== 0 && String(v).toLowerCase() !== 'false'
const clamp = (v: number) => Math.max(-100, Math.min(100, v))
/** EV3 move-steering curve: 0 drives straight, ±100 spins in place. */
const steer = (steering: number, speed: number): [number, number] => {
  const turn = Math.max(-100, Math.min(100, steering))
  const power = clamp(speed)
  if (turn >= 0) return [power, clamp(power * (100 - 2 * turn) / 100)]
  return [clamp(power * (100 + 2 * turn) / 100), power]
}
export const compare = (a: number, b: number, code: string): boolean => {
  switch (code) { case '0': return Math.abs(a - b) < 0.5; case '1': return Math.abs(a - b) >= 0.5; case '2': return a > b; case '3': return a >= b; case '4': return a < b; case '5': return a <= b; default: throw Error(`Unsupported comparison ${code}`) }
}

/** Cooperative EV3 block execution. All waits are advanced by tick(), never wall time. */
export class EV3Runtime {
  time = 0
  sensors: Sensors = { distance: 75, angle: 0, touch2: false, touch3: false }
  motors: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0 }
  variables: Record<string, Value> = {}
  active: string[] = []
  error = ''
  notes = ['Sound durations are approximated; clamp motors have no physical mechanism.']
  private configuredSpeed: Record<string, number> = { '1': 50, '2': 50, '3': 50, '4': 50 }
  private rotations: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0 }
  private pair = ['1', '4']
  private movementSpeed = 50
  private gyroZero = 0
  private previousTouch: [boolean, boolean] = [false, false]
  private threads: Thread[] = []
  private serial = 0
  private currentThread = 0
  private sequence = 0
  private events: ExecutionEvent[] = []
  private records = new Map<string, ScriptExecution>()
  private inspections: Record<string, BlockInspection> = {}
  private breakpoints = new Set<string>()
  private bypass = new Set<string>()
  private listeners = new Set<(event: ExecutionEvent) => void>()
  breakpoint: { scriptId: string; blockId: string } | null = null
  private scripts: Script[]
  private functions = new Map<string, Block[]>()
  constructor(program: Program) {
    this.scripts = program.targets.flatMap(t => t.scripts)
    for (const target of program.targets) {
      for (const v of target.variables) this.variables[v.id] = v.saved_value
      for (const f of target.functions) this.functions.set(f.name, f.steps)
    }
    for (const script of this.scripts) this.records.set(script.script_id, { scriptId: script.script_id, blockId: null, status: 'idle', ancestors: [], progress: {} })
    for (const script of this.scripts) if (script.trigger.opcode === 'ev3events_whenProgramStarts') this.spawn(script)
  }
  get wheels(): [number, number] { return [this.motors[this.pair[0]], this.motors[this.pair[1]]] }
  get gyro(): number { return this.sensors.angle - this.gyroZero }
  get threadCount(): number { return this.threads.length }
  setBreakpoints(ids: Iterable<string>): void { this.breakpoints = new Set(ids) }
  resume(): void {
    if (this.breakpoint) this.bypass.add(`${this.breakpoint.scriptId}:${this.breakpoint.blockId}`)
    this.breakpoint = null
  }
  subscribe(listener: (event: ExecutionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  snapshot(): ExecutionSnapshot {
    return { time: this.time, scripts: [...this.records.values()].map(s => ({ ...s, ancestors: [...s.ancestors], progress: { ...s.progress } })), events: [...this.events], inspections: structuredClone(this.inspections), breakpoint: this.breakpoint ? { ...this.breakpoint } : null, error: this.error }
  }
  private token(kind: Token['kind'], context: Context, reason?: string, progress: Record<string, Value> = {}): Token { return { ...context, kind, reason, progress } }
  private emit(type: ExecutionEvent['type'], thread: Thread, token?: Token, reason?: string): void {
    const event: ExecutionEvent = { sequence: ++this.sequence, type, scriptId: thread.script, runId: thread.id, blockId: token?.block.block_id ?? (type === 'script-stop' ? this.scripts.find(s => s.script_id === thread.script)?.trigger.block_id ?? null : null), time: this.time, wallTime: Date.now(), reason, ancestors: [...(token?.ancestors ?? [])], instant: type === 'block-complete' && !['control_', 'procedures_call', 'ev3move_move', 'ev3motor_motorTurnFor', 'ev3sensors_wait', 'ev3sound_playSoundUntilDone', 'event_broadcastandwait'].some(prefix => token?.block.opcode.startsWith(prefix)) }
    this.events.push(event)
    if (this.events.length > 300) this.events.shift()
    for (const listener of this.listeners) listener(event)
  }
  private describe(thread: Thread, token: Token, capture = false): void {
    thread.status = token.kind === 'waiting' ? 'waiting' : 'running'
    const id = token.block.block_id
    this.records.set(thread.script, { scriptId: thread.script, runId: thread.id, blockId: id, status: thread.status, reason: token.reason, ancestors: [...token.ancestors], progress: { ...token.progress } })
    if (token.kind !== 'before' || capture) {
      const previous = capture ? undefined : this.inspections[`${thread.script}:${id}`]
      const inputs = previous?.inputs ?? Object.fromEntries(Object.keys(token.block.inputs ?? {}).map(key => [key, this.input(token.block, key, token.locals)]))
      this.inspections[`${thread.script}:${id}`] = { blockId: id, scriptId: thread.script, inputs, fields: Object.fromEntries(Object.entries(token.block.fields ?? {}).map(([k,v]) => [k,v.value])), status: thread.status, ancestors: [...token.ancestors], progress: Object.keys(token.progress).length ? { ...token.progress } : { ...previous?.progress } }
    }
  }
  private finish(thread: Thread, reason = 'finished'): void {
    this.emit('script-stop', thread, thread.pending, reason)
    this.records.set(thread.script, { scriptId: thread.script, runId: thread.id, blockId: null, status: reason === 'error' ? 'error' : 'finished', reason, ancestors: [], progress: {} })
    this.threads = this.threads.filter(t => t !== thread)
  }
  private prime(thread: Thread): void {
    const next = thread.generator.next()
    if (next.done) { this.finish(thread); return }
    thread.pending = next.value
    this.describe(thread, next.value)
  }
  private spawn(script: Script): number {
    const existing = this.threads.find(t => t.script === script.script_id)
    if (existing) return existing.id
    const id = ++this.serial
    const thread: Thread = { id, script: script.script_id, generator: this.execute(script.steps, {}), status: 'running' }
    this.threads.push(thread)
    this.prime(thread)
    return id
  }
  broadcast(message: string): number[] {
    return this.scripts.filter(s => s.trigger.opcode === 'event_whenbroadcastreceived' && String(s.trigger.fields?.BROADCAST_OPTION.value) === message).map(s => this.spawn(s))
  }
  /** Returns false when a breakpoint prevents this shared simulation tick. */
  tick(dt: number, sensors: Sensors, singleStep = false): boolean {
    if (this.error) return false
    if (this.breakpoint && !singleStep) return false
    if (singleStep) this.resume()
    this.sensors = sensors
    const touches: [boolean, boolean] = [sensors.touch2, sensors.touch3]
    for (const script of this.scripts) {
      if (script.trigger.opcode !== 'ev3events_whenEV3TouchSensorPressed') continue
      const port = String(this.input(script.trigger, 'PORT', {}))
      const i = port === '2' ? 0 : port === '3' ? 1 : undefined
      if (i === undefined) continue
      const pressed = String(script.trigger.fields?.EVENT.value) === '1'
      if (touches[i] !== this.previousTouch[i] && touches[i] === pressed) this.spawn(script)
    }
    this.previousTouch = touches
    for (const thread of this.threads) {
      const token = thread.pending
      if (token?.kind !== 'before') continue
      const key = `${thread.script}:${token.block.block_id}`
      if (!singleStep && this.breakpoints.has(token.block.block_id) && !this.bypass.has(key)) {
        this.breakpoint = { scriptId: thread.script, blockId: token.block.block_id }
        thread.status = 'breakpoint'
        this.records.set(thread.script, { ...this.records.get(thread.script)!, status: 'breakpoint', reason: 'Breakpoint before execution' })
        return false
      }
    }
    this.time += dt
    for (const port of Object.keys(this.motors)) this.rotations[port] += Math.abs(this.motors[port]) / 100 * 2 * dt
    try {
      for (const thread of [...this.threads]) {
        if (!this.threads.includes(thread) || !thread.pending) continue
        this.currentThread = thread.id
        const token = thread.pending
        if (token.kind === 'before') {
          this.bypass.delete(`${thread.script}:${token.block.block_id}`)
          this.emit('block-enter', thread, token)
          this.describe(thread, token, true)
        }
        let current = token
        if (token.kind !== 'complete') {
          const next = thread.generator.next()
          if (next.done) { this.finish(thread); continue }
          thread.pending = current = next.value
        }
        this.describe(thread, current)
        if (current.kind === 'waiting' && token.kind !== 'waiting') this.emit('block-wait', thread, current, current.reason)
        if (current.kind === 'complete') {
          this.emit('block-complete', thread, current)
          if (this.inspections[`${thread.script}:${current.block.block_id}`]) this.inspections[`${thread.script}:${current.block.block_id}`].status = 'finished'
          this.prime(thread)
        }
      }
      this.active = this.threads.flatMap(t => t.pending ? [t.pending.block.block_id] : [])
    } catch (error) {
      this.error = String(error)
      for (const key of Object.keys(this.motors)) this.motors[key] = 0
      for (const thread of [...this.threads]) this.finish(thread, 'error')
    }
    return true
  }
  private input(block: Expression, name: string, locals: Record<string, Value>): Value { return this.evaluate(block.inputs?.[name]?.value, locals) }
  private evaluate(exp: Expression | undefined, locals: Record<string, Value>): Value {
    if (!exp) return false
    if (exp.kind === 'variable') return this.variables[exp.reference_id ?? ''] ?? 0
    if (!exp.opcode) return exp.value ?? false
    if (exp.kind === 'menu') return Object.values(exp.fields ?? {})[0]?.value ?? ''
    const input = (key: string) => this.input(exp, key, locals)
    const num = (key: string) => number(input(key))
    switch (exp.opcode) {
      case 'argument_reporter_string_number': return locals[String(exp.fields?.VALUE.value)] ?? ''
      case 'operator_add': return num('NUM1') + num('NUM2')
      case 'operator_subtract': return num('NUM1') - num('NUM2')
      case 'operator_multiply': return num('NUM1') * num('NUM2')
      case 'operator_divide': { const divisor = num('NUM2'); if (!divisor) throw Error('Division by zero'); return num('NUM1') / divisor }
      case 'operator_mod': { const divisor = num('NUM2'); if (!divisor) throw Error('Modulo by zero'); return ((num('NUM1') % divisor) + divisor) % divisor }
      case 'operator_equals': { const a = input('OPERAND1'), b = input('OPERAND2'); return Number.isFinite(Number(a)) && Number.isFinite(Number(b)) ? Number(a) === Number(b) : String(a).toLowerCase() === String(b).toLowerCase() }
      case 'operator_gt': return num('OPERAND1') > num('OPERAND2')
      case 'operator_lt': return num('OPERAND1') < num('OPERAND2')
      case 'operator_and': return truth(input('OPERAND1')) && truth(input('OPERAND2'))
      case 'operator_or': return truth(input('OPERAND1')) || truth(input('OPERAND2'))
      case 'operator_not': return !truth(input('OPERAND'))
      case 'operator_join': return String(input('STRING1')) + String(input('STRING2'))
      case 'ev3sensors_getEV3UltrasonicSensorDistance': return String(exp.fields?.UNIT.value) === 'inches' ? this.sensors.distance / 2.54 : this.sensors.distance
      case 'ev3sensors_isEV3UltrasonicSensorDistance': return compare(String(exp.fields?.UNIT.value) === 'inches' ? this.sensors.distance / 2.54 : this.sensors.distance, num('VALUE'), String(exp.fields?.COMPARATOR.value))
      case 'ev3sensors_getEV3GyroSensorAngle': return Math.round(this.gyro)
      case 'ev3sensors_isEV3TouchSensorPressed': { const port = String(input('PORT')); return port === '2' ? this.sensors.touch2 : port === '3' ? this.sensors.touch3 : false }
      default: throw Error(`Unsupported expression: ${exp.opcode}`)
    }
  }
  private *execute(steps: Block[], locals: Record<string, Value>, depth = 0, ancestors: string[] = []): Generator<Token, void> {
    if (depth > 100) throw Error('Custom function recursion limit exceeded')
    for (const block of steps) {
      const op = block.opcode
      const context: Context = { block, locals, ancestors }
      let completionProgress: Record<string, Value> = {}
      yield this.token('before', context)
      const input = (key: string) => this.input(block, key, locals)
      const num = (key: string) => number(input(key))
      const field = (key: string) => String(block.fields?.[key]?.value ?? '')
      switch (op) {
        case 'control_if': case 'control_if_else':
          yield this.token('running', context)
          yield* this.execute(block.branches?.[truth(input('CONDITION')) ? 'body' : 'else'] ?? [], locals, depth, [...ancestors, block.block_id])
          break
        case 'control_repeat_until':
          while (!truth(input('CONDITION'))) { yield this.token('running', context); yield* this.execute(block.branches?.body ?? [], locals, depth, [...ancestors, block.block_id]) }
          yield this.token('running', context); break
        case 'control_wait': { const duration = Math.max(0, num('DURATION')), start = this.time, until = start + duration; while (this.time < until) yield this.token('waiting', context, 'time', { requestedSeconds: duration, elapsedSeconds: this.time - start, remainingSeconds: Math.max(0, until - this.time) }); break }
        case 'control_wait_until': while (!truth(input('CONDITION'))) yield this.token('waiting', context, 'sensor / condition', { condition: input('CONDITION') }); break
        case 'data_setvariableto': this.variables[block.fields?.VARIABLE.reference_id ?? ''] = input('VALUE'); break
        case 'data_changevariableby': { const key = block.fields?.VARIABLE.reference_id ?? ''; this.variables[key] = number(this.variables[key] ?? 0) + num('VALUE'); break }
        case 'procedures_call': {
          const call = block.function_call
          const body = this.functions.get(call?.name ?? '')
          if (!call || !body) throw Error(`Missing function ${call?.name}`)
          const args = Object.fromEntries(call.arguments.map(a => [a.name, this.evaluate(a.value, locals)]))
          yield this.token('running', context); yield* this.execute(body, args, depth + 1, [...ancestors, block.block_id]); break
        }
        case 'event_broadcast': this.broadcast(String(input('BROADCAST_INPUT'))); break
        case 'event_broadcastandwait': {
          const children = this.broadcast(String(input('BROADCAST_INPUT')))
          while (this.threads.some(t => children.includes(t.id))) yield this.token('waiting', context, 'parallel scripts', { childScripts: children.length })
          break
        }
        case 'ev3control_stopOtherStacks': for (const other of [...this.threads]) if (other.id !== this.currentThread) this.finish(other, 'stopped by another script'); break
        case 'ev3move_setMovementPair': this.pair = [String(input('LEFT_PORT')), String(input('RIGHT_PORT'))]; break
        case 'ev3move_startSteer': {
          const [left, right] = steer(num('STEERING'), this.movementSpeed)
          this.motors[this.pair[0]] = left
          this.motors[this.pair[1]] = right
          break
        }
        case 'ev3move_movementSpeed': this.movementSpeed = clamp(num('SPEED')); break
        case 'ev3motor_motorSetSpeed': this.configuredSpeed[String(input('PORT'))] = clamp(num('SPEED')); break
        case 'ev3motor_motorStartSpeed': this.motors[String(input('PORT'))] = clamp(num('SPEED')); break
        case 'ev3motor_motorStop': this.motors[String(input('PORT'))] = 0; break
        case 'ev3move_move': case 'ev3motor_motorTurnFor': {
          const ports = op === 'ev3move_move' ? [...this.pair] : [String(input('PORT'))]
          const direction = ['back', 'counterclockwise'].includes(field('DIRECTION')) ? -1 : 1
          const power = op === 'ev3move_move' ? this.movementSpeed : this.configuredSpeed[ports[0]]
          const amount = Math.abs(num('VALUE'))
          const target = field('UNIT') === 'degrees' ? amount / 360 : amount
          const start = this.rotations[ports[0]], until = this.time + amount
          if (amount > 0) {
            ports.forEach(p => { this.motors[p] = clamp(direction * power) })
            while (field('UNIT') === 'seconds' ? this.time < until : this.rotations[ports[0]] - start < target) yield this.token('waiting', context, 'movement', { requested: amount, unit: field('UNIT'), completedRotations: this.rotations[ports[0]] - start, ...(field('UNIT') === 'seconds' ? { remainingSeconds: Math.max(0, until - this.time) } : { targetRotations: target }), motorPower: power, motorPort: ports.join(' / ') })
          }
          completionProgress = { requested: amount, unit: field('UNIT'), completedRotations: this.rotations[ports[0]] - start, ...(field('UNIT') === 'seconds' ? { remainingSeconds: Math.max(0, until - this.time) } : { targetRotations: target }), motorPower: power, motorPort: ports.join(' / ') }
          ports.forEach(p => { this.motors[p] = 0 }); break
        }
        case 'ev3sensors_resetEV3GyroSensorAngle': this.gyroZero = this.sensors.angle; break
        case 'ev3sensors_waitEV3GyroSensorAngle': {
          const code = field('EVENT'), start = this.gyro, target = num('VALUE')
          let previous = this.gyro
          while (true) {
            const now = this.gyro
            // Treat crossing an equality threshold as a match between fixed samples.
            const done = code === '-1' ? Math.abs(now - start) >= Math.abs(target) : code === '0' ? compare(now, target, code) || (previous - target) * (now - target) <= 0 : compare(now, target, code)
            if (done) break
            previous = now; yield this.token('waiting', context, 'gyro sensor', { currentAngle: now, targetAngle: target })
          }
          break
        }
        case 'ev3sensors_waitEV3TouchSensorTouch': {
          const port = String(input('PORT')), pressed = field('EVENT') === '1'
          while ((port === '2' ? this.sensors.touch2 : this.sensors.touch3) !== pressed) yield this.token('waiting', context, 'touch sensor', { port, requestedPressed: pressed, currentPressed: port === '2' ? this.sensors.touch2 : this.sensors.touch3 })
          break
        }
        case 'ev3sound_playSoundUntilDone': { const until = this.time + 0.5; while (this.time < until) yield this.token('waiting', context, 'sound / time', { remainingSeconds: Math.max(0, until - this.time) }); break }
        case 'ev3sound_playSound': case 'ev3sound_setVolumeTo': case 'ev3move_moveSetStopAction': case 'ev3motor_motorSetStopAction': break
        default: throw Error(`Unsupported command: ${op}`)
      }
      yield this.token('complete', context, undefined, completionProgress)
    }
  }
}

export const EMPTY_EXECUTION: ExecutionSnapshot = { time: 0, scripts: [], events: [], inspections: {}, breakpoint: null, error: '' }
