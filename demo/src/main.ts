import { DEFAULT_PORT } from '../../src/shared/protocol'
import { personalities } from './personalities'
import { Producer } from './producer'

const STAGGER_MS = 1200

function usage(): void {
  console.log('usage: pnpm demo [personality...] [--host H] [--port N] [--list]')
  console.log(`personalities: ${personalities.map(p => p.key).join(', ')} (default: all)`)
}

const args = process.argv.slice(2)
let host = '127.0.0.1'
let port = DEFAULT_PORT
const keys: string[] = []

for (const arg of args) {
  if (arg === '--list' || arg === '--help' || arg === '-h') {
    usage()
    process.exit(0)
  } else if (arg.startsWith('--host=')) {
    host = arg.slice('--host='.length)
  } else if (arg.startsWith('--port=')) {
    port = Number(arg.slice('--port='.length))
  } else if (arg.startsWith('--')) {
    console.error(`unknown option: ${arg}`)
    usage()
    process.exit(1)
  } else {
    keys.push(arg)
  }
}

const selected = keys.length === 0
  ? personalities
  : keys.map(key => {
      const found = personalities.find(p => p.key === key)
      if (!found) {
        console.error(`unknown personality: ${key}`)
        usage()
        process.exit(1)
      }
      return found
    })

console.log(`auspex demo: ${selected.map(p => p.key).join(', ')} -> ${host}:${port}`)

const producers = selected.map(
  (personality, index) => new Producer(personality, host, port, 40000 + index),
)
producers.forEach((producer, index) => {
  setTimeout(() => producer.start(), index * STAGGER_MS)
})

process.on('SIGINT', () => {
  for (const producer of producers) producer.stop()
  process.exit(0)
})
