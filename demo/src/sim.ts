// Personality definitions: a declarative shape for a fake instrumented app.
// The producer walks these specs once per simulated frame and emits zone
// trees with randomized durations, plus counters, markers, GC sawtooths and
// occasional hitches.

export type ZoneSpec = {
  name: string
  base: number // mean self-duration in ms (excluding children)
  jitter?: number // multiplicative variance 0..1, default 0.25
  chance?: number // probability of occurring each frame, default 1
  children?: ZoneSpec[]
}

export type CounterSpec = {
  name: string
  next: (dtMs: number) => number
}

export type HitchSpec = {
  name: string
  marker?: boolean
  meanIntervalMs: number
  durationMs: [number, number]
}

export type ThreadSpec = {
  tid: number
  name: string
  zones: ZoneSpec[]
}

export type GcSpec = {
  limitMb: number
  floorMb: number
  ratePerSec: number
  pauseMs: [number, number]
}

export type Personality = {
  key: string
  appName: string
  fps: number
  main: ThreadSpec
  render?: ThreadSpec // pipelined: services frame N right after main finishes it
  jobs?: ThreadSpec[]
  jobChance?: number // per job thread per frame, default 0.5
  counters: CounterSpec[]
  hitches: HitchSpec[]
  gc?: GcSpec
  // Per-frame multiplier on all zone durations; lets a personality have bad
  // pacing (bimodal bursts) without bespoke code.
  frameScale?: (frame: number) => number
}

export function jitterMul(jitter: number): number {
  return 1 + jitter * (Math.random() * 2 - 1)
}

export function randomIn([min, max]: [number, number]): number {
  return min + Math.random() * (max - min)
}

export function makeWander(start: number, step: number, min: number, max: number): (dtMs: number) => number {
  let value = start
  return () => {
    value += (Math.random() * 2 - 1) * step
    value = Math.min(max, Math.max(min, value))
    return Math.round(value)
  }
}

export function makeBursty(base: number, peak: number, burstChance: number, decay: number): (dtMs: number) => number {
  let level = 0
  return () => {
    if (Math.random() < burstChance) level = peak
    level *= decay
    return Math.round(base + level)
  }
}
