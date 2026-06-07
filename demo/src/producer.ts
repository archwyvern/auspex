import { Socket } from 'node:net'
import { DEFAULT_PORT, StringTable, type Msg } from '../../src/shared/protocol'
import { jitterMul, randomIn, type Personality, type ZoneSpec } from './sim'

const RETRY_MS = 2000

type PendingZone = { name: string; durationMs: number }

// One simulated instrumented app: dials out to the profiler, retries lazily
// while it is not reachable (mirroring the planned SDK behaviour), and streams
// one batch of NDJSON messages per simulated frame.
export class Producer {
  private socket: Socket | null = null
  private strings: StringTable | null = null
  private batch: Msg[] = []
  private timer: NodeJS.Timeout | null = null
  private stopped = false

  private frame = 0
  private simTimeUs = 0
  private sessionStartMs = 0
  private renderEndUs = 0
  private heapMb = 0
  private pending: PendingZone[] = []

  constructor(
    private readonly personality: Personality,
    private readonly host: string,
    private readonly port: number = DEFAULT_PORT,
    private readonly fakePid: number = process.pid,
  ) {}

  start(): void {
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.socket?.destroy()
  }

  private log(message: string): void {
    console.log(`[${this.personality.key}] ${message}`)
  }

  private connect(): void {
    if (this.stopped) return
    const socket = new Socket()
    this.socket = socket

    socket.on('error', () => {})
    socket.on('close', () => {
      if (this.timer) clearTimeout(this.timer)
      if (this.stopped) return
      this.log(`not connected, retrying in ${RETRY_MS / 1000}s`)
      this.timer = setTimeout(() => this.connect(), RETRY_MS)
    })

    socket.connect(this.port, this.host, () => {
      this.log(`connected as "${this.personality.appName}" (pid ${this.fakePid})`)
      this.beginSession()
    })
  }

  private beginSession(): void {
    const p = this.personality
    this.strings = new StringTable(msg => this.batch.push(msg))
    this.frame = 0
    this.simTimeUs = 0
    this.renderEndUs = 0
    this.heapMb = p.gc ? p.gc.floorMb : 0
    this.pending = []
    this.sessionStartMs = Date.now()

    this.batch.push({
      t: 'hello',
      v: 1,
      pid: this.fakePid,
      name: p.appName,
      start: this.sessionStartMs,
      tsFreq: 1_000_000,
    })
    for (const thread of [p.main, p.render, ...(p.jobs ?? [])]) {
      if (thread) this.batch.push({ t: 'thread', tid: thread.tid, name: this.strings.id(thread.name) })
    }
    this.scheduleFrame()
  }

  private scheduleFrame(): void {
    if (this.stopped || !this.socket || this.socket.destroyed) return
    const targetWallMs = this.sessionStartMs + this.simTimeUs / 1000
    const delay = Math.max(0, targetWallMs - Date.now())
    this.timer = setTimeout(() => this.runFrame(), delay)
  }

  private runFrame(): void {
    if (!this.socket || this.socket.destroyed || !this.strings) return
    const p = this.personality
    const intervalUs = 1_000_000 / p.fps
    const scale = p.frameScale ? p.frameScale(this.frame) : 1
    const frameStartUs = this.simTimeUs
    const strings = this.strings

    this.batch.push({ t: 'fm', tid: p.main.tid, ts: Math.round(frameStartUs), frame: this.frame })

    // Counters sampled at frame start.
    for (const counter of p.counters) {
      this.batch.push({
        t: 'ctr',
        ts: Math.round(frameStartUs),
        name: strings.id(counter.name),
        value: counter.next(1000 / p.fps),
      })
    }

    // Main thread zone tree.
    let cursor = frameStartUs
    for (const zone of p.main.zones) cursor = this.walkZone(zone, cursor, p.main.tid, scale)

    // Hitches queued from the previous frame (GC pauses) plus freshly rolled
    // ones land as extra top-level zones extending this frame.
    for (const spec of p.hitches) {
      if (Math.random() < 1000 / p.fps / spec.meanIntervalMs) {
        this.pending.push({ name: spec.name, durationMs: randomIn(spec.durationMs) })
        if (spec.marker) this.batch.push({ t: 'mk', tid: p.main.tid, ts: Math.round(cursor), name: strings.id(spec.name) })
      }
    }
    for (const hitch of this.pending) {
      this.batch.push({ t: 'zb', tid: p.main.tid, ts: Math.round(cursor), name: strings.id(hitch.name) })
      cursor += hitch.durationMs * 1000
      this.batch.push({ t: 'ze', tid: p.main.tid, ts: Math.round(cursor) })
    }
    this.pending = []
    const mainEndUs = cursor

    // GC sawtooth: heap climbs, hits the limit, drops to the floor and queues
    // a pause zone for the next frame.
    if (p.gc) {
      this.heapMb += p.gc.ratePerSec / p.fps
      if (this.heapMb >= p.gc.limitMb) {
        this.heapMb = p.gc.floorMb
        this.batch.push({ t: 'mk', tid: p.main.tid, ts: Math.round(mainEndUs), name: strings.id('GC') })
        this.pending.push({ name: 'GCPause', durationMs: randomIn(p.gc.pauseMs) })
      }
      this.batch.push({ t: 'ctr', ts: Math.round(frameStartUs), name: strings.id('heapMB'), value: Math.round(this.heapMb) })
    }

    // Render thread services this frame right after the main thread finishes
    // it, serialized against its own previous frame (pipelining).
    if (p.render) {
      let renderCursor = Math.max(mainEndUs + 300, this.renderEndUs)
      this.batch.push({ t: 'fm', tid: p.render.tid, ts: Math.round(renderCursor), frame: this.frame })
      for (const zone of p.render.zones) renderCursor = this.walkZone(zone, renderCursor, p.render.tid, scale)
      this.renderEndUs = renderCursor
    }

    // Job threads: intermittent tasks somewhere inside the frame window.
    for (const job of p.jobs ?? []) {
      if (Math.random() > (p.jobChance ?? 0.5)) continue
      let jobCursor = frameStartUs + Math.random() * intervalUs * 0.4
      for (const zone of job.zones) jobCursor = this.walkZone(zone, jobCursor, job.tid, scale)
    }

    this.flush()

    // Next frame starts on schedule, or late if this one blew the budget.
    this.frame++
    this.simTimeUs = Math.max(frameStartUs + intervalUs, mainEndUs)
    this.scheduleFrame()
  }

  private walkZone(spec: ZoneSpec, cursorUs: number, tid: number, scale: number): number {
    if (!this.strings) return cursorUs
    if (spec.chance !== undefined && Math.random() > spec.chance) return cursorUs
    this.batch.push({ t: 'zb', tid, ts: Math.round(cursorUs), name: this.strings.id(spec.name) })
    let cursor = cursorUs
    for (const child of spec.children ?? []) cursor = this.walkZone(child, cursor, tid, scale)
    cursor += spec.base * jitterMul(spec.jitter ?? 0.25) * scale * 1000
    this.batch.push({ t: 'ze', tid, ts: Math.round(cursor) })
    return cursor
  }

  private flush(): void {
    if (!this.socket || this.batch.length === 0) return
    const lines = this.batch.map(msg => JSON.stringify(msg)).join('\n') + '\n'
    this.batch = []
    this.socket.write(lines)
  }
}
