import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Check, ChevronDown, ChevronRight, SquareFunction, X } from 'lucide-react'
import { cn } from 'cn'
import type { Block, ExecutionSnapshot, Program, ScriptExecution } from './runtime'
import { blockLabel, expression, scriptLabel } from './codeLabels'
import { BlockContents } from './BlockAppearance'
import { CATEGORIES, blockCategory } from './blockCategories'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Props = { program: Program | null; execution: ExecutionSnapshot; breakpoints: Set<string>; toggleBreakpoint: (id: string) => void; enabled: boolean; error: string }

const categoryColor = Object.fromEntries(CATEGORIES.map(category => [category.id, category.color]))

function flatten(steps: Block[]): Block[] { return steps.flatMap(b => [b, ...Object.values(b.branches ?? {}).flatMap(flatten)]) }
function valueText(value: unknown): string { return typeof value === 'number' ? Number.isInteger(value) ? String(value) : value.toFixed(3) : String(value) }
function branchTitle(opcode: string, name: string) {
  if (name === 'else') return 'else'
  if ((opcode === 'control_if' || opcode === 'control_if_else') && name === 'body') return 'then'
  return null
}

function StatusText({ status }: { status?: string }) {
  if (!status || status === 'idle') return null
  const dot = status === 'waiting' ? 'bg-amber-400' : status === 'breakpoint' ? 'bg-red-500' : status === 'error' ? 'bg-destructive' : status === 'finished' ? 'bg-muted-foreground/40' : 'bg-emerald-500'
  const label = status === 'breakpoint' ? 'paused' : status
  return <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-muted-foreground capitalize"><i className={cn('size-1.5 rounded-full', dot)} />{label}</span>
}

export default function LiveCodeViewer({ program, execution, breakpoints, toggleBreakpoint, enabled, error }: Props) {
  const [inspectedScript, setInspectedScript] = useState('')
  const [follow, setFollow] = useState(true), [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set()), [logOpen, setLogOpen] = useState(false)
  const [showAll, setShowAll] = useState(true), [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [now, setNow] = useState(() => Date.now())
  const pane = useRef<HTMLDivElement>(null), lastFollow = useRef('')
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(timer) }, [])
  const scripts = program?.targets.flatMap(t => t.scripts) ?? []
  const functions = program?.targets.flatMap(t => t.functions) ?? []
  const blocks = useMemo(() => new Map((program?.targets.flatMap(t => [...t.scripts.flatMap(s => flatten(s.steps)), ...t.functions.flatMap(f => flatten(f.steps))]) ?? []).map(b => [b.block_id, b])), [program])
  const executions = enabled ? execution.scripts : []
  const statuses = new Map(executions.map(s => [s.scriptId, s]))
  const active = executions.filter(s => s.blockId && ['running', 'waiting', 'breakpoint'].includes(s.status))
  const activeIds = new Set(active.map(s => s.blockId))
  const containers = new Set(active.flatMap(s => s.ancestors))
  const flashed = new Set(enabled ? execution.events.filter(e => e.type === 'block-complete' && e.instant && now - e.wallTime < 650).map(e => e.blockId) : [])
  const reached = new Set(execution.events.filter(e => e.type === 'block-enter').map(e => e.blockId))
  const isExpanded = (id: string, steps?: Block[]) => (!collapsed.has(id) && (showAll || expanded.has(id))) || follow && (containers.has(id) || activeIds.has(id) || !!steps?.some(b => activeIds.has(b.block_id) || containers.has(b.block_id)))
  const toggleExpanded = (id: string) => { if (isExpanded(id)) setCollapsed(old => new Set([...old, id])); else { setCollapsed(old => { const next = new Set(old); next.delete(id); return next }); setExpanded(old => new Set([...old, id])) } }
  const signature = active.map(s => `${s.scriptId}:${s.blockId}`).join('|')
  useEffect(() => {
    if (!follow || !signature || signature === lastFollow.current) return
    lastFollow.current = signature
    // Scroll only the code pane: following code must never move the whole page.
    const scroller = pane.current
    const node = scroller?.querySelector<HTMLElement>('[data-current="true"]')
    if (!scroller || !node) return
    const outer = scroller.getBoundingClientRect(), inner = node.getBoundingClientRect()
    if (inner.top < outer.top || inner.bottom > outer.bottom) scroller.scrollTop += inner.top - outer.top - 70
  }, [follow, signature])
  const renderSteps = (steps: Block[]) => <ol className="m-0 flex list-none flex-col gap-1 p-0">{steps.map(b => {
    const instances = active.filter(s => s.blockId === b.block_id)
    const state = instances.find(s => s.status === 'breakpoint') ?? instances.find(s => s.status === 'waiting') ?? instances[0]
    const nested = !!b.branches
    const open = isExpanded(b.block_id)
    const category = blockCategory(b)
    const color = categoryColor[category] ?? '#a3a3a3'
    return <li key={b.block_id}>
      <div className={cn('flex items-start gap-1.5 rounded-lg border bg-background px-1.5 py-1.5 shadow-sm', flashed.has(b.block_id) && 'border-lime-400 bg-lime-50', !state && containers.has(b.block_id) && 'border-sky-300 bg-sky-50', state?.status === 'waiting' && 'border-amber-300 bg-amber-50', state?.status === 'breakpoint' && 'border-red-300 bg-red-50', state && state.status !== 'waiting' && state.status !== 'breakpoint' && 'border-emerald-400 bg-emerald-50', selected === b.block_id && 'ring-2 ring-inset ring-foreground/35')} data-current={!!state} data-block-id={b.block_id}>
        <button type="button" className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full" title={breakpoints.has(b.block_id) ? 'Remove breakpoint' : 'Set breakpoint before execution'} aria-label={`${breakpoints.has(b.block_id) ? 'Remove' : 'Set'} breakpoint: ${blockLabel(b)}`} aria-pressed={breakpoints.has(b.block_id)} onClick={() => toggleBreakpoint(b.block_id)}><span className={cn('size-2 rounded-full border border-foreground/25', breakpoints.has(b.block_id) && 'border-red-600 bg-red-500')} /></button>
        <span className="mt-1 h-3.5 w-1 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
        {nested ? <button type="button" className="mt-0.5 shrink-0 border-0 bg-transparent p-0 text-muted-foreground" aria-label={`${open ? 'Collapse' : 'Expand'} ${blockLabel(b)}`} aria-expanded={open} onClick={() => toggleExpanded(b.block_id)}>{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</button> : null}
        <button type="button" className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left text-xs leading-6 font-medium text-foreground" onClick={() => { setSelected(b.block_id); setInspectedScript('') }} aria-label={blockLabel(b)} title={`Inspect ${b.block_id}`}><BlockContents block={b} />{b.function_call && <ArrowUpRight className="ml-0.5 inline size-3 align-text-bottom text-muted-foreground" aria-hidden="true" />}</button>
        {instances.length > 1 && <span className="mt-0.5 rounded-md bg-amber-100 px-1 text-[10px] font-semibold text-amber-900">×{instances.length}</span>}
        {state?.status === 'waiting' && <span className="mt-0.5 rounded-md bg-amber-200/80 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-amber-950 uppercase">{state.reason === 'movement' ? 'moving' : 'wait'}</span>}
        {reached.has(b.block_id) && !state && <Check className="mt-1 size-3 shrink-0 text-emerald-600/70" aria-label="Executed" />}
      </div>
      {nested && open && <div className="mt-1 ml-3.5 flex flex-col gap-1.5 border-l-2 pl-2.5" style={{ borderColor: color }}>{Object.entries(b.branches ?? {}).map(([name, children]) => {
        const title = branchTitle(b.opcode, name)
        return <div key={name}>{title && <div className="px-0.5 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground capitalize">{title}</div>}{renderSteps(children)}</div>
      })}</div>}
    </li>
  })}</ol>
  const selectedBlock = selected ? blocks.get(selected) : undefined
  const invocations = selected ? Object.values(execution.inspections).filter(i => i.blockId === selected) : []
  const inspection = invocations.find(i => i.scriptId === inspectedScript) ?? invocations[0]
  const current = selected ? active.find(s => s.blockId === selected && (!inspection || s.scriptId === inspection.scriptId)) : undefined
  const selectedInputs = inspection?.inputs ?? Object.fromEntries(Object.entries(selectedBlock?.inputs ?? {}).map(([key, input]) => [key, expression(input.value)]))
  const progress = current?.progress && Object.keys(current.progress).length ? current.progress : inspection?.progress ?? {}
  const liveBorder = (status?: ScriptExecution) => status?.status === 'waiting' ? 'border-amber-300' : status?.status === 'breakpoint' ? 'border-red-300' : status && ['running'].includes(status.status) ? 'border-emerald-300' : ''
  return <section className="flex min-h-0 flex-1 flex-col gap-2.5">
    <div className="flex items-center gap-2">
      <h2 className="font-heading text-sm font-semibold">Code</h2>
      {program && <span className="min-w-0 truncate text-xs text-muted-foreground">{program.project_name}</span>}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Label className={cn('h-7 gap-1.5 rounded-md border px-2 text-xs font-medium', follow ? 'border-border bg-card text-foreground' : 'border-transparent text-muted-foreground')}><Checkbox checked={follow} onCheckedChange={checked => { setFollow(checked === true); lastFollow.current = '' }} />Follow</Label>
        <Button type="button" variant="outline" size="xs" onClick={() => { setShowAll(!showAll); setCollapsed(new Set()); setExpanded(new Set()) }}>{showAll ? 'Collapse' : 'Expand'}</Button>
      </div>
    </div>
    {!enabled && <p className="text-sm text-muted-foreground">Loading EV3 program…</p>}
    {execution.breakpoint && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 wrap-anywhere" role="status">Paused before {blockLabel(blocks.get(execution.breakpoint.blockId) ?? { block_id: '', opcode: 'block' })}</div>}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    {active.length > 0 && <ul className="max-h-24 overflow-auto rounded-lg border bg-card">{active.map(s => <li className="flex items-center gap-2 border-b px-2.5 py-1.5 text-xs last:border-b-0" key={s.scriptId}><i className={cn('size-1.5 shrink-0 rounded-full', s.status === 'waiting' ? 'bg-amber-400' : s.status === 'breakpoint' ? 'bg-red-500' : 'bg-emerald-500')} /><span className="shrink-0 font-medium capitalize">{s.status === 'waiting' ? (s.reason === 'movement' ? 'Moving' : 'Waiting') : s.status}</span><span className="min-w-0 truncate text-muted-foreground">{blockLabel(blocks.get(s.blockId!) ?? { block_id: '', opcode: 'block' })}</span></li>)}</ul>}
    <div ref={pane} className="min-h-40 flex-1 space-y-5 overflow-auto md:min-h-0">
      <div>
        <div className="mb-2 flex items-baseline justify-between"><h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Scripts</h3><span className="text-[11px] tabular-nums text-muted-foreground">{scripts.length}</span></div>
        <div className="flex flex-col gap-2">{scripts.map((s, i) => {
          const status = statuses.get(s.script_id), open = isExpanded(s.script_id, flatten(s.steps))
          return <article key={s.script_id} className={cn('overflow-hidden rounded-lg border bg-card shadow-sm', liveBorder(status))}><button type="button" className="flex w-full items-center gap-2 px-2.5 py-2 text-left" onClick={() => toggleExpanded(s.script_id)} aria-expanded={open}>{open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}<span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-[#efc300] text-[10px] font-semibold text-[#584b14] tabular-nums">{String(i + 1).padStart(2, '0')}</span><span className="min-w-0 flex-1 truncate text-xs font-medium">{scriptLabel(s)}</span><StatusText status={status?.status} /></button>{open && <div className="border-t bg-muted/40 p-2">{renderSteps(s.steps)}</div>}</article>
        })}</div>
      </div>
      <div>
        <div className="mb-2 flex items-baseline justify-between"><h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Functions</h3><span className="text-[11px] tabular-nums text-muted-foreground">{functions.length}</span></div>
        <div className="flex flex-col gap-2">{functions.map(f => {
          const key = `function:${f.name}`, open = isExpanded(key, flatten(f.steps)), busy = flatten(f.steps).some(b => activeIds.has(b.block_id) || containers.has(b.block_id))
          return <article key={key} className={cn('overflow-hidden rounded-lg border bg-card shadow-sm', busy && 'border-sky-300')}><button type="button" className="flex w-full items-center gap-2 px-2.5 py-2 text-left" onClick={() => toggleExpanded(key)} aria-expanded={open}>{open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}<span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-[#ff5075] text-white"><SquareFunction className="size-3" aria-hidden="true" /></span><span className="min-w-0 flex-1 truncate text-xs font-medium">{f.name}</span>{busy && <StatusText status="running" />}</button>{open && <div className="border-t bg-muted/40 p-2">{renderSteps(f.steps)}</div>}</article>
        })}</div>
      </div>
    </div>
    {selectedBlock && <section className="max-h-56 overflow-auto rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold">Inspector</h3><Button type="button" variant="ghost" size="icon-xs" onClick={() => setSelected(null)} aria-label="Close block inspector"><X /></Button></div>
      <p className="mt-2 text-xs font-medium wrap-anywhere">{blockLabel(selectedBlock)}</p>
      <small className="font-mono text-[11px] wrap-anywhere text-muted-foreground">{selectedBlock.block_id}</small>
      {invocations.length > 1 && <Label className="mt-3 flex-col items-stretch gap-1.5 text-xs font-normal text-muted-foreground">Inspect script<Select value={inspection?.scriptId ?? ''} onValueChange={value => { if (value) setInspectedScript(value) }}><SelectTrigger className="w-full" size="sm" aria-label="Inspect script"><SelectValue /></SelectTrigger><SelectContent>{invocations.map(i => <SelectItem key={i.scriptId} value={i.scriptId}>{scripts.find(s => s.script_id === i.scriptId) ? scriptLabel(scripts.find(s => s.script_id === i.scriptId)!) : i.scriptId}</SelectItem>)}</SelectContent></Select></Label>}
      <p className="my-2 text-xs text-muted-foreground">{inspection ? `Last run · ${current?.status ?? inspection.status}` : 'Not executed yet'}</p>
      <dl className="overflow-hidden rounded-md border text-xs">{Object.entries(selectedInputs).map(([key, value]) => <div className="flex gap-3 border-b px-2 py-1.5 last:border-b-0" key={key}><dt className="min-w-20 text-muted-foreground">{key}</dt><dd className="ml-auto text-right wrap-anywhere">{valueText(value)}</dd></div>)}{Object.entries(inspection?.fields ?? Object.fromEntries(Object.entries(selectedBlock.fields ?? {}).map(([key, field]) => [key, field.value]))).map(([key, value]) => <div className="flex gap-3 border-b px-2 py-1.5 last:border-b-0" key={`field:${key}`}><dt className="min-w-20 text-muted-foreground">{key}</dt><dd className="ml-auto text-right wrap-anywhere">{valueText(value)}</dd></div>)}{Object.entries(progress).map(([key, value]) => <div className="flex gap-3 border-b px-2 py-1.5 last:border-b-0" key={key}><dt className="min-w-20 text-muted-foreground">{key.replace(/([A-Z])/g, ' $1')}</dt><dd className="ml-auto text-right wrap-anywhere">{valueText(value)}</dd></div>)}</dl>
      {selectedBlock.function_call && <p className="mt-2 text-xs text-muted-foreground">Arguments: {selectedBlock.function_call.arguments.map(a => `${a.name} = ${expression(a.value)}`).join(', ') || 'none'}</p>}
      <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => toggleBreakpoint(selectedBlock.block_id)}>{breakpoints.has(selectedBlock.block_id) ? 'Remove breakpoint' : 'Set breakpoint'}</Button>
    </section>}
    <Collapsible open={logOpen} onOpenChange={setLogOpen} className="border-t pt-1">
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-xs font-medium hover:bg-muted">{logOpen ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}Log<span className="ml-auto text-[11px] font-normal tabular-nums text-muted-foreground">{execution.events.length}</span></CollapsibleTrigger>
      <CollapsibleContent><div className="max-h-56 overflow-auto">{[...execution.events].reverse().map(event => <div className="grid grid-cols-[3rem_1fr] gap-x-2 border-b py-2 text-xs" key={event.sequence}><time className="tabular-nums text-muted-foreground">{event.time.toFixed(2)}s</time><div><div className="flex items-baseline gap-2"><span className={cn('font-medium', event.type === 'block-wait' && 'text-amber-700', event.type === 'block-complete' && 'text-emerald-700')}>{event.type}</span><span className="ml-auto text-[10px] text-muted-foreground">script {Math.max(1, scripts.findIndex(s => s.script_id === event.scriptId) + 1)} · run {event.runId}</span></div><p className="mt-0.5 text-foreground">{event.type === 'script-stop' ? event.reason : event.blockId ? blockLabel(blocks.get(event.blockId) ?? { block_id: '', opcode: 'block' }) : event.reason}</p>{event.blockId && <p className="mt-0.5 font-mono text-[10px] wrap-anywhere text-muted-foreground">{event.blockId}</p>}</div></div>)}{!execution.events.length && <p className="py-2 text-sm text-muted-foreground">Events appear when the program runs.</p>}</div></CollapsibleContent>
    </Collapsible>
  </section>
}
