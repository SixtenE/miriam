import { strFromU8, unzipSync } from 'fflate'
import type { Block, Expression, Program, Value } from './runtime'

type ScratchMutation = {
  tagName?: string
  children?: unknown[]
  proccode?: string
  argumentids?: string
  argumentnames?: string
  argumentdefaults?: string
  warp?: string | boolean
}

type ScratchBlock = {
  opcode: string
  next: string | null
  inputs: Record<string, unknown>
  fields: Record<string, unknown>
  shadow: boolean
  topLevel: boolean
  x?: number
  y?: number
  mutation?: ScratchMutation
  comment?: string
}

type ScratchTarget = {
  isStage?: boolean
  name?: string
  variables?: Record<string, unknown>
  lists?: Record<string, unknown>
  broadcasts?: Record<string, unknown>
  blocks?: Record<string, unknown>
  comments?: Record<string, unknown>
}

export type ConvertedProgram = Program & {
  schema_version: '1.0'
  source_file: string
  summary: Program['summary'] & {
    covered_blocks: number
    event_scripts: number
    custom_functions: number
    detached_stacks: number
    variables: number
  }
  interpretation_notes: string[]
  manifest: unknown
  original_scratch_project: unknown
}

const PRIMITIVE_KIND: Record<number, string> = {
  4: 'number',
  5: 'positive_number',
  6: 'whole_number',
  7: 'integer_number',
  8: 'angle',
  9: 'color',
  10: 'text',
  11: 'broadcast',
  12: 'variable',
  13: 'list',
}

const NOTES = [
  'Steps follow each Scratch block next pointer; nested control bodies are stored in branches.body and branches.else.',
  'Scripts run in response to their own triggers and may execute concurrently; scripts array order does not imply a global execution order.',
  'EV3 field values, port encodings, and opcodes are preserved exactly rather than guessing their meanings.',
  'Literal values and saved variable values retain their original types, including numeric strings. Saved variable values are not necessarily program initialization values.',
  'Detached stacks have no event trigger and do not run automatically.',
  'All source blocks, mutations, comments, and project metadata are retained in original_scratch_project.',
]

const asRecord = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

const savedValue = (value: unknown): Value => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : value == null ? '' : String(value)

const parseList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(item => String(item))
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.map(item => String(item)) : []
  } catch {
    return []
  }
}

const baseName = (path: string) => (path.split('/').pop() ?? path).toLowerCase()

const findEntry = (files: Record<string, Uint8Array>, names: string[]) => {
  const wanted = new Set(names.map(name => name.toLowerCase()))
  const key = Object.keys(files).find(path => !path.includes('__MACOSX') && wanted.has(baseName(path)))
  return key ? files[key] : undefined
}

const unzip = (data: Uint8Array, label: string) => {
  try {
    return unzipSync(data)
  } catch {
    throw new Error(label)
  }
}

const parseJson = (bytes: Uint8Array, label: string) => {
  try {
    return JSON.parse(strFromU8(bytes)) as unknown
  } catch {
    throw new Error(label)
  }
}

const readScratchProject = (files: Record<string, Uint8Array>) => {
  const sb3Key = Object.keys(files).find(path => !path.includes('__MACOSX') && baseName(path).endsWith('.sb3'))
  if (sb3Key) {
    const inner = unzip(files[sb3Key], 'The scratch.sb3 archive inside this file could not be read.')
    const project = findEntry(inner, ['project.json'])
    if (!project) throw new Error('The scratch.sb3 archive does not contain project.json.')
    return parseJson(project, 'The Scratch project inside this file is not valid JSON.')
  }
  const project = findEntry(files, ['project.json'])
  if (!project) throw new Error('This file does not contain a Scratch project.')
  return parseJson(project, 'The Scratch project inside this file is not valid JSON.')
}

const scratchBlock = (value: unknown): ScratchBlock | null => {
  const record = asRecord(value)
  if (!record || typeof record.opcode !== 'string') return null
  return {
    opcode: record.opcode,
    next: typeof record.next === 'string' ? record.next : null,
    inputs: asRecord(record.inputs) ?? {},
    fields: asRecord(record.fields) ?? {},
    shadow: record.shadow === true,
    topLevel: record.topLevel === true,
    x: typeof record.x === 'number' ? record.x : undefined,
    y: typeof record.y === 'number' ? record.y : undefined,
    mutation: asRecord(record.mutation) ? record.mutation as ScratchMutation : undefined,
    comment: typeof record.comment === 'string' ? record.comment : undefined,
  }
}

const isHat = (opcode: string) => opcode.startsWith('event_') || opcode.startsWith('ev3events_')

const isConvertedProgram = (value: unknown): value is ConvertedProgram => {
  const record = asRecord(value)
  return !!record && Array.isArray(record.targets) && record.targets.some(target => Array.isArray(asRecord(target)?.scripts))
}

const isScratchProject = (value: unknown) => {
  const record = asRecord(value)
  return !!record && Array.isArray(record.targets) && record.targets.some(target => !!asRecord(asRecord(target)?.blocks))
}

/** Load an .lmsp archive, a converted simulator JSON file, or a Scratch project.json. */
export function loadProgram(data: Uint8Array | ArrayBuffer, sourceFile = 'program.lmsp'): ConvertedProgram {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const jsonFile = sourceFile.toLowerCase().endsWith('.json')
  if (jsonFile || bytes[0] === 0x7b) {
    let parsed: unknown
    try { parsed = JSON.parse(strFromU8(bytes)) as unknown }
    catch { if (jsonFile) throw new Error('This JSON file could not be read.') }
    if (isConvertedProgram(parsed)) return parsed
    if (isScratchProject(parsed)) {
      const name = sourceFile.replace(/\.json$/i, '') || 'program'
      return convertProject(parsed, { sourceFile, projectName: name, manifest: null })
    }
    if (jsonFile) throw new Error('This JSON file is not a simulator program.')
  }
  return convertLmsp(bytes, sourceFile)
}

/** Convert an EV3 Classroom .lmsp archive into the program JSON the simulator runs. */
export function convertLmsp(data: Uint8Array | ArrayBuffer, sourceFile = 'program.lmsp'): ConvertedProgram {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const files = unzip(bytes, 'Could not read this file as a .lmsp archive.')
  const project = readScratchProject(files)
  const manifestBytes = findEntry(files, ['manifest.jsn', 'manifest.json'])
  const manifest = manifestBytes ? parseJson(manifestBytes, 'The project manifest is not valid JSON.') : null
  const manifestName = asRecord(manifest)?.name
  const projectName = typeof manifestName === 'string' && manifestName ? manifestName : sourceFile.replace(/\.(lmsp|sb3|zip)$/i, '') || 'program'
  return convertProject(project, { sourceFile, projectName, manifest })
}

function convertProject(project: unknown, meta: { sourceFile: string; projectName: string; manifest: unknown }): ConvertedProgram {
  const root = asRecord(project)
  if (!root || !Array.isArray(root.targets)) throw new Error('The Scratch project has no targets.')
  let sourceBlocks = 0
  let coveredBlocks = 0
  let eventScripts = 0
  let customFunctions = 0
  let detachedStacks = 0
  let variables = 0
  const targets = root.targets.map(target => {
    const converted = convertTarget(target)
    sourceBlocks += converted.sourceBlocks
    coveredBlocks += converted.coveredBlocks
    eventScripts += converted.target.scripts.length
    customFunctions += converted.target.functions.length
    detachedStacks += converted.target.detached_stacks.length
    variables += converted.target.variables.length
    return converted.target
  })
  return {
    schema_version: '1.0',
    source_file: meta.sourceFile,
    project_name: meta.projectName,
    summary: { source_blocks: sourceBlocks, covered_blocks: coveredBlocks, event_scripts: eventScripts, custom_functions: customFunctions, detached_stacks: detachedStacks, variables },
    interpretation_notes: NOTES,
    manifest: meta.manifest,
    targets,
    original_scratch_project: project,
  }
}

function convertTarget(value: unknown) {
  const target = asRecord(value) as ScratchTarget | null
  if (!target) throw new Error('The Scratch project contains an invalid target.')
  const blocks = new Map<string, ScratchBlock>()
  for (const [id, block] of Object.entries(target.blocks ?? {})) {
    const parsed = scratchBlock(block)
    if (parsed) blocks.set(id, parsed)
  }
  const prototypes = new Map<string, ScratchMutation>()
  for (const block of blocks.values()) {
    if (block.opcode === 'procedures_prototype' && block.mutation?.proccode) prototypes.set(block.mutation.proccode, block.mutation)
  }
  const cache = new Map<string, Block>()
  const visited = new Set<string>()

  const convertPrimitive = (parts: unknown[]): Expression => {
    const type = Number(parts[0])
    const expression: Expression = { kind: PRIMITIVE_KIND[type] ?? 'text', value: savedValue(parts[1]) }
    if (type === 11 || type === 12 || type === 13) expression.reference_id = typeof parts[2] === 'string' ? parts[2] : null
    return expression
  }

  const convertBlock = (id: string): Block => {
    const cached = cache.get(id)
    if (cached) return cached
    const raw = blocks.get(id)
    if (!raw) throw new Error(`Missing Scratch block ${id}.`)
    const block: Block & { kind: string; mutation?: ScratchMutation; comment_id?: string } = { block_id: id, opcode: raw.opcode, kind: raw.shadow ? 'menu' : 'block' }
    if (raw.comment) block.comment_id = raw.comment
    cache.set(id, block)
    visited.add(id)
    const fields = convertFields(raw.fields)
    if (fields) block.fields = fields
    const inputs: NonNullable<Block['inputs']> & Record<string, { connection_type?: number; value: Expression; shadow_default?: Expression }> = {}
    const branches: NonNullable<Block['branches']> = {}
    for (const [key, input] of Object.entries(raw.inputs)) {
      if (!Array.isArray(input)) continue
      if (key === 'SUBSTACK' || key === 'SUBSTACK2') {
        if (typeof input[1] === 'string') branches[key === 'SUBSTACK' ? 'body' : 'else'] = chain(input[1])
        continue
      }
      const slot: { connection_type: number; value: Expression; shadow_default?: Expression } = { connection_type: Number(input[0]), value: convertSlot(input[1]) }
      if (input.length > 2 && input[2] !== undefined) slot.shadow_default = convertSlot(input[2])
      inputs[key] = slot
    }
    if (Object.keys(inputs).length) block.inputs = inputs
    if (Object.keys(branches).length) block.branches = branches
    if (raw.mutation) block.mutation = raw.mutation
    if (raw.opcode === 'procedures_call') block.function_call = functionCall(raw, block)
    return block
  }

  const convertSlot = (slot: unknown): Expression => {
    if (typeof slot === 'string') return convertBlock(slot)
    if (Array.isArray(slot)) return convertPrimitive(slot)
    throw new Error('A Scratch block input has an unexpected value.')
  }

  const chain = (start: string | null): Block[] => {
    const steps: Block[] = []
    const seen = new Set<string>()
    let id = start
    while (id && !seen.has(id) && blocks.has(id)) {
      seen.add(id)
      steps.push(convertBlock(id))
      id = blocks.get(id)?.next ?? null
    }
    return steps
  }

  const functionCall = (raw: ScratchBlock, block: Block): NonNullable<Block['function_call']> => {
    const ids = parseList(raw.mutation?.argumentids)
    const prototype = prototypes.get(raw.mutation?.proccode ?? '')
    const names = parseList(prototype?.argumentnames)
    return {
      name: raw.mutation?.proccode ?? '',
      arguments: ids.map((argumentId, index) => ({ id: argumentId, name: names[index] ?? argumentId, value: block.inputs?.[argumentId]?.value ?? { kind: 'text', value: '' } })),
    }
  }

  const position = (block: ScratchBlock) => ({ x: block.x ?? 0, y: block.y ?? 0 })
  const scripts = []
  const functions = []
  const detached = []
  for (const [id, block] of blocks) {
    if (!block.topLevel) continue
    if (block.opcode === 'procedures_definition') {
      const prototypeId = Array.isArray(block.inputs.custom_block) ? block.inputs.custom_block[1] : undefined
      const prototype = typeof prototypeId === 'string' ? blocks.get(prototypeId)?.mutation : undefined
      const ids = parseList(prototype?.argumentids)
      const names = parseList(prototype?.argumentnames)
      const defaults = parseList(prototype?.argumentdefaults)
      functions.push({
        definition_block_id: id,
        name: prototype?.proccode ?? '',
        parameters: ids.map((argumentId, index) => ({ id: argumentId, name: names[index] ?? '', default: defaults[index] ?? '' })),
        run_without_screen_refresh: prototype?.warp === true || prototype?.warp === 'true',
        position: position(block),
        definition: convertBlock(id),
        steps: chain(block.next),
      })
    } else if (isHat(block.opcode)) {
      scripts.push({ script_id: id, activation: 'event', position: position(block), trigger: convertBlock(id), steps: chain(block.next) })
    } else {
      detached.push({ stack_id: id, runs_automatically: false, position: position(block), steps: chain(id) })
    }
  }
  const supplemental = [...blocks.keys()].filter(id => !visited.has(id)).map(convertBlock)
  const variableList = Object.entries(target.variables ?? {}).map(([id, entry]) => {
    const pair = Array.isArray(entry) ? entry : []
    return { id, name: String(pair[0] ?? ''), saved_value: savedValue(pair[1]) }
  })
  return {
    sourceBlocks: blocks.size,
    coveredBlocks: visited.size,
    target: {
      name: target.name ?? '',
      is_stage: target.isStage === true,
      variables: variableList,
      lists: Object.entries(target.lists ?? {}).map(([id, entry]) => {
        const pair = Array.isArray(entry) ? entry : []
        return { id, name: String(pair[0] ?? ''), saved_value: pair[1] }
      }),
      broadcasts: Object.entries(target.broadcasts ?? {}).map(([id, name]) => ({ id, name: String(name) })),
      comments: target.comments ?? {},
      scripts,
      functions,
      detached_stacks: detached,
      supplemental_blocks: supplemental,
    },
  }
}

function convertFields(fields: Record<string, unknown>) {
  const converted: NonNullable<Block['fields']> = {}
  for (const [key, field] of Object.entries(fields)) {
    if (!Array.isArray(field)) continue
    converted[key] = { value: savedValue(field[0]), reference_id: typeof field[1] === 'string' ? field[1] : null }
  }
  return Object.keys(converted).length ? converted : undefined
}
