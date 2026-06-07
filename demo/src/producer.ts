import { Socket } from 'node:net'
import { DEFAULT_PORT, REC_SIZES, StringTable } from '../../src/shared/protocol'
import { WireWriter } from './wire'
import { jitterMul, randomIn, type Personality, type ZoneSpec } from './sim'

const RETRY_MS = 2000

type PendingZone = { name: string; durationMs: number }

// One simulated instrumented app: dials out to the profiler, retries lazily
// while it is not reachable (mirroring the planned SDK behaviour), and
// streams one batch of wire frames per simulated frame.
export class Producer {
  private socket: Socket | null = null
  private strings: StringTable | null = null
  private writer = new WireWriter()
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
    this.writer = new WireWriter()
    this.strings = new StringTable(msg => this.writer.control(msg))
    this.frame = 0
    this.simTimeUs = 0
    this.renderEndUs = 0
    this.heapMb = p.gc ? p.gc.floorMb : 0
    this.pending = []
    this.sessionStartMs = Date.now()

    this.writer.control({
      t: 'hello',
      v: 1,
      pid: this.fakePid,
      name: p.appName,
      start: this.sessionStartMs,
      tsFreq: 1_000_000,
      fps: p.targetFps ?? p.fps,
      sizes: REC_SIZES,
    })
    for (const thread of [p.main, p.render, ...(p.jobs ?? [])]) {
      if (thread) this.writer.control({ t: 'thread', tid: thread.tid, name: this.strings.id(thread.name) })
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
    const writer = this.writer

    writer.frameMark(p.main.tid, Math.round(frameStartUs), this.frame)

    // Counters sampled at frame start.
    for (const counter of p.counters) {
      writer.counter(Math.round(frameStartUs), strings.id(counter.name), counter.next(1000 / p.fps))
    }

    // Main thread zone tree.
    let cursor = frameStartUs
    for (const zone of p.main.zones) cursor = this.walkZone(zone, cursor, p.main.tid, scale)

    // Hitches queued from the previous frame (GC pauses) plus freshly rolled
    // ones land as extra top-level zones extending this frame.
    for (const spec of p.hitches) {
      if (Math.random() < 1000 / p.fps / spec.meanIntervalMs) {
        this.pending.push({ name: spec.name, durationMs: randomIn(spec.durationMs) })
        if (spec.marker) writer.marker(p.main.tid, Math.round(cursor), strings.id(spec.name))
      }
    }
    for (const hitch of this.pending) {
      writer.zoneBegin(p.main.tid, Math.round(cursor), strings.id(hitch.name))
      cursor += hitch.durationMs * 1000
      writer.zoneEnd(p.main.tid, Math.round(cursor))
    }
    this.pending = []
    const mainEndUs = cursor

    // GC sawtooth: heap climbs, hits the limit, drops to the floor and queues
    // a pause zone for the next frame.
    if (p.gc) {
      this.heapMb += p.gc.ratePerSec / p.fps
      if (this.heapMb >= p.gc.limitMb) {
        this.heapMb = p.gc.floorMb
        writer.marker(p.main.tid, Math.round(mainEndUs), strings.id('GC'))
        this.pending.push({ name: 'GCPause', durationMs: randomIn(p.gc.pauseMs) })
      }
      writer.counter(Math.round(frameStartUs), strings.id('heapMB'), Math.round(this.heapMb))
    }

    // Render thread services this frame right after the main thread finishes
    // it, serialized against its own previous frame (pipelining).
    if (p.render) {
      let renderCursor = Math.max(mainEndUs + 300, this.renderEndUs)
      writer.frameMark(p.render.tid, Math.round(renderCursor), this.frame)
      for (const zone of p.render.zones) renderCursor = this.walkZone(zone, renderCursor, p.render.tid, scale)
      this.renderEndUs = renderCursor
    }

    // Job threads: intermittent tasks somewhere inside the frame window.
    for (const job of p.jobs ?? []) {
      if (Math.random() > (p.jobChance ?? 0.5)) continue
      let jobCursor = frameStartUs + Math.random() * intervalUs * 0.4
      for (const zone of job.zones) jobCursor = this.walkZone(zone, jobCursor, job.tid, scale)
    }

    this.writer.flush(this.socket)

    // Next frame starts on schedule, or late if this one blew the budget.
    this.frame++
    this.simTimeUs = Math.max(frameStartUs + intervalUs, mainEndUs)
    this.scheduleFrame()
  }

  private walkZone(spec: ZoneSpec, cursorUs: number, tid: number, scale: number): number {
    if (!this.strings) return cursorUs
    if (spec.chance !== undefined && Math.random() > spec.chance) return cursorUs
    this.writer.zoneBegin(tid, Math.round(cursorUs), this.strings.id(spec.name))
    let cursor = cursorUs
    for (const child of spec.children ?? []) cursor = this.walkZone(child, cursor, tid, scale)
    cursor += spec.base * jitterMul(spec.jitter ?? 0.25) * scale * 1000
    this.writer.zoneEnd(tid, Math.round(cursor))
    return cursor
  }
}
