import { useEffect, useRef, useState } from 'react'
import type { Program, Value } from './runtime'
import { cn } from 'cn'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type Props = { program: Program | null; values: Record<string, Value>; running: boolean; enabled: boolean; time: number }

const HIGHLIGHT_MS = 1600

function statusLabel(enabled: boolean, running: boolean, time: number) {
  if (!enabled) return 'Loading'
  if (running) return 'Live'
  if (time > 0) return 'Paused'
  return 'Ready'
}

export default function VariablesPanel({ program, values, running, enabled, time }: Props) {
  const variables = program?.targets.flatMap(target => target.variables) ?? []
  const label = statusLabel(enabled, running, time)
  const previous = useRef<Record<string, Value> | null>(null)
  const timers = useRef<Record<string, number>>({})
  const [updatedAt, setUpdatedAt] = useState<Record<string, number>>({})
  const [highlighted, setHighlighted] = useState<Record<string, true>>({})

  useEffect(() => {
    const prior = previous.current
    previous.current = { ...values }
    if (!prior) return
    const changed = Object.keys(values).filter(id => id in prior && !Object.is(prior[id], values[id]))
    if (!changed.length) return
    const stamp = performance.now()
    setUpdatedAt(current => {
      const next = { ...current }
      for (const id of changed) next[id] = stamp
      return next
    })
    setHighlighted(current => {
      const next = { ...current }
      for (const id of changed) next[id] = true
      return next
    })
    for (const id of changed) {
      window.clearTimeout(timers.current[id])
      timers.current[id] = window.setTimeout(() => {
        delete timers.current[id]
        setHighlighted(current => {
          if (!current[id]) return current
          const next = { ...current }
          delete next[id]
          return next
        })
      }, HIGHLIGHT_MS)
    }
  }, [values])

  useEffect(() => () => {
    for (const timer of Object.values(timers.current)) window.clearTimeout(timer)
  }, [])

  const sorted = [...variables].sort((a, b) => (updatedAt[b.id] ?? 0) - (updatedAt[a.id] ?? 0))

  return <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label="Live program variables">
    <div className="flex items-center justify-between gap-2">
      <h2 className="font-heading text-base font-medium">Variables <span className="text-xs font-normal text-muted-foreground">{variables.length}</span></h2>
      <Badge variant={label === 'Live' ? 'default' : 'secondary'}>{label}</Badge>
    </div>
    {!program ? <p className="text-sm text-muted-foreground">Loading program…</p> : <ScrollArea className="min-h-0 flex-1"><Table>
      <TableHeader className="sticky top-0 z-10 bg-background"><TableRow><TableHead>Variable</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
      <TableBody>{sorted.map(variable => {
        const value = values[variable.id] ?? variable.saved_value
        const text = value === '' ? '""' : typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('en', { maximumSignificantDigits: 7, useGrouping: false }).format(value) : String(value)
        const hot = !!highlighted[variable.id]
        const stamp = updatedAt[variable.id] ?? 0
        return <TableRow key={variable.id} data-variable-id={variable.id} data-updated={hot ? 'true' : undefined}>
          <TableCell key={`name-${stamp}`} className={cn('font-medium wrap-break-word whitespace-normal transition-colors duration-700', hot && 'variable-flash')}>{variable.name}</TableCell>
          <TableCell key={`value-${stamp}`} className={cn('text-right transition-colors duration-700', hot && 'variable-flash')}><output className={cn('font-mono text-xs tabular-nums', hot && 'font-semibold')} aria-label={`${variable.name} value`} title={`${String(value)} (${typeof value})`}>{text}</output></TableCell>
        </TableRow>
      })}</TableBody>
    </Table></ScrollArea>}
  </section>
}
