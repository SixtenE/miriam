import { ArrowLeftRight, Circle, Cog, Flag, Music, Plus, Radar, Repeat, SquareFunction } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type {Block} from './runtime'
export const CATEGORIES: {id:string;name:string;icon:LucideIcon;color:string}[] = [
  {id:'motor',name:'Motors',icon:Cog,color:'#008cf0'},
  {id:'movement',name:'Movement',icon:ArrowLeftRight,color:'#ee38c4'},
  {id:'sound',name:'Sound',icon:Music,color:'#9861ed'},
  {id:'event',name:'Events',icon:Flag,color:'#e6b400'},
  {id:'control',name:'Control',icon:Repeat,color:'#ffa600'},
  {id:'sensor',name:'Sensors',icon:Radar,color:'#00b8d9'},
  {id:'operator',name:'Operators',icon:Plus,color:'#00af53'},
  {id:'variable',name:'Variables',icon:Circle,color:'#ff8c1a'},
  {id:'function',name:'My blocks',icon:SquareFunction,color:'#ff5075'},
]

export function blockCategory(block: Pick<Block,'opcode'|'function_call'>): string {
  const op=block.opcode
  if(block.function_call || op.startsWith('procedures_') || op.startsWith('argument_'))return 'function'
  if(op.startsWith('ev3motor_'))return 'motor'
  if(op.startsWith('ev3move_'))return 'movement'
  if(op.startsWith('ev3sound_'))return 'sound'
  if(op.startsWith('ev3sensors_'))return 'sensor'
  if(op.startsWith('operator_'))return 'operator'
  if(op.startsWith('data_'))return 'variable'
  if(op.startsWith('control_'))return 'control'
  return 'event'
}
