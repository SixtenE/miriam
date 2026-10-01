import { Compass, Cog, Hand, Radar } from 'lucide-react'
import { Separator } from '@/components/ui/separator'

export type HardwareData = { distance: number; gyro: number; touch2: boolean; touch3: boolean; motorOutputs: Record<string, number> }

const hardwareIcons = { distance: Radar, touch: Hand, gyro: Compass, motor: Cog }

function HardwareIcon({ kind }: { kind: keyof typeof hardwareIcons }) {
  const Icon = hardwareIcons[kind]
  return <Icon aria-hidden="true" className="size-6 shrink-0 text-muted-foreground" />
}

function Metric({ port, kind, label, value, unit, ariaLabel }: { port: string; kind: 'distance' | 'gyro' | 'motor'; label: string; value: string; unit: string; ariaLabel: string }) {
  return <div className="flex items-center gap-2" aria-label={ariaLabel}>
    <span className="text-xs text-muted-foreground">{port}</span>
    <HardwareIcon kind={kind} />
    <div>
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className="block text-sm font-semibold whitespace-nowrap text-foreground tabular-nums">{value}<span className="ml-0.5 text-xs font-normal text-muted-foreground">{unit}</span></span>
    </div>
  </div>
}

function TouchReadout({ port, pressed }: { port: 2 | 3; pressed: boolean }) {
  const value = pressed ? 1 : 0
  return <div className="flex items-center gap-2" aria-label={`Port ${port} Touch: ${value}`}>
    <span className="text-xs text-muted-foreground">{port}</span>
    <HardwareIcon kind="touch" />
    <div>
      <span className="block text-xs text-muted-foreground">Touch</span>
      <span className="block text-sm font-semibold whitespace-nowrap text-foreground tabular-nums">{value}</span>
    </div>
  </div>
}

export default function HardwareStrip({ data }: { data: HardwareData }) {
  return <section className="flex shrink-0 items-center gap-4 overflow-x-auto border-b bg-background px-4 py-2.5" aria-label="Live sensors and motors">
    <div className="flex items-center gap-4" aria-label="Sensor inputs">
      <Metric port="1" kind="distance" label="Ultrasonic" value={data.distance.toFixed(0)} unit="cm" ariaLabel={`Port 1 Ultrasonic: ${data.distance.toFixed(0)} cm`} />
      <TouchReadout port={2} pressed={data.touch2} />
      <TouchReadout port={3} pressed={data.touch3} />
      <Metric port="4" kind="gyro" label="Gyro" value={data.gyro.toFixed(0)} unit="°" ariaLabel={`Port 4 Gyro: ${data.gyro.toFixed(0)} °`} />
    </div>
    <Separator orientation="vertical" className="h-8" />
    <div className="flex items-center gap-4" aria-label="Motor outputs">{[['1', 'A', 'Left'], ['2', 'B', 'Clamp'], ['3', 'C', 'Unused'], ['4', 'D', 'Right']].map(([id, port, name]) => {
      const power = (data.motorOutputs[id] ?? 0).toFixed(0)
      return <Metric key={id} port={port} kind="motor" label={name} value={power} unit="%" ariaLabel={`Motor ${port}: ${power} percent`} />
    })}</div>
  </section>
}
