import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), threeDeprecationPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})

// @react-three/fiber 9.8.1 still constructs THREE.Clock, and rapier3d-compat 0.19.2
// still calls wasm init with a positional argument. Both are already the latest
// releases those packages publish, so rewrite the call sites while bundling.
function threeDeprecationPlugin(): Plugin {
  return {
    name: 'three-deprecations',
    transform(code, id) {
      return dependencyTransform(code, id)
    },
    config() {
      return {
        optimizeDeps: {
          rolldownOptions: {
            plugins: [{
              name: 'three-deprecations-optimize',
              transform(code, id) {
                return dependencyTransform(code, id)
              },
            }],
          },
        },
      }
    },
  }
}

function dependencyTransform(code: string, id: string) {
  const next = rewriteDependency(code, id)
  if (next == null) return null
  return { code: next, map: null }
}

export function rewriteDependency(code: string, id: string): string | null {
  const file = id.split('?')[0]
  if (/rapier3d-compat[\\/]rapier\.(?:mjs|cjs)$/.test(file)) return rewriteRapierInit(code)
  if (/@react-three[\\/]fiber[\\/]dist[\\/]events-[^\\/]+\.js$/.test(file)) return rewriteFiberClock(code)
  return null
}

function rewriteRapierInit(code: string): string | null {
  if (!code.includes('.toByteArray(')) return null
  const next = code.replace(
    /yield (\w+)\((\w+)\.toByteArray\("([^"]*)"\)\.buffer\)/,
    (_match, fn: string, bytes: string, data: string) => `yield ${fn}({module_or_path:${bytes}.toByteArray("${data}").buffer})`,
  )
  return next === code ? null : next
}

function rewriteFiberClock(code: string): string | null {
  const match = code.match(/new (THREE(?:__namespace)?)\.Clock\(\)/)
  if (!match) return null
  const three = match[1]
  const replaced = code.replaceAll(`new ${three}.Clock()`, 'createFiberClock()')
  if (code.includes('function createFiberClock(')) return replaced
  return `${fiberClockShim(three)}\n${replaced}`
}

function fiberClockShim(three: string): string {
  return `function createFiberClock(){
  const timer = new ${three}.Timer()
  let running = false
  let elapsedTime = 0
  let oldTime = 0
  let autoStart = true
  const clock = {
    get elapsedTime(){return elapsedTime},
    set elapsedTime(value){elapsedTime = value},
    get oldTime(){return oldTime},
    set oldTime(value){oldTime = value},
    start(){
      oldTime = performance.now()
      elapsedTime = 0
      running = true
      timer.reset()
    },
    stop(){
      clock.getElapsedTime()
      running = false
      autoStart = false
    },
    getElapsedTime(){
      clock.getDelta()
      return elapsedTime
    },
    getDelta(){
      if (autoStart && !running) {
        clock.start()
        return 0
      }
      if (!running) return 0
      timer.update()
      const diff = timer.getDelta()
      oldTime = performance.now()
      elapsedTime += diff
      return diff
    }
  }
  return clock
}`
}
