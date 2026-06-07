import type { ControlMsg } from '../../../shared/protocol'
import { CounterSeries, FrameIndex, OPEN_END, Track } from './columns'
import { WireParser } from './wire'

const MARKER_CAP = 1000
const FM_WINDOW = 90
const TICK_MS = 200
const MAX_TRACK_ROWS = 1 << 21
const MAX_FRAME_ROWS = 1 << 20
const MAX_COUNTER_ROWS = 1 << 17
const SNAPSHOT_FRAMES = 60
const SNAPSHOT_CAP = 900
const SNAPSHOT_ZONE_CAP = 40

export type ZoneStat = {
  nameId: number
  name: string
  count: number
  totalUs: number
  selfUs: number
  maxUs: number
}

// One bar of the average-frame picture: a zone identity (thread, depth, name)
// with its mean position and duration within the frame, and how often it
// occurs per frame (ghosting for occasional zones).
export type FrameShapeZone = {
  tid: number
  depth: number
  nameId: number
  name: string
  avgOffsetUs: number
  avgDurUs: number
  perFrame: number
}

export type Snapshot = {
  seq: number
  startUs: number
  endUs: number
  frames: number
  fps: number
  frameAvgUs: number
  frameMaxUs: number
  // Budget captured at snapshot time so a frozen AVG view is fully static.
  budgetUs: number
  zones: ZoneStat[]
  shape: FrameShapeZone[]
}

export type ThreadInfo = {
  tid: number
  name: string
  events: number
}

export type MarkerEntry = {
  tsUs: number
  tid: number
  name: string
}

export type CounterInfo = {
  nameId: number
  name: string
  latest: number
  series: CounterSeries
}

export type Session = {
  id: number
  status: 'handshaking' | 'live' | 'closed'
  name: string | null
  pid: number | null
  startMs: number | null
  tsFreq: number
  strings: Map<number, string>
  threads: Map<number, ThreadInfo>
  counters: Map<number, CounterInfo>
  markers: MarkerEntry[]
  tracks: Map<number, Track>
  frames: FrameIndex
  snapshots: Snapshot[]
  maxTs: number
  budgetUs: number
  framesTotal: number
  zones: number
  events: number
  eventsRate: number
  fps: number
  parseErrors: number
  // internals
  parser: WireParser
  mainTid: number | null
  fmTimes: number[]
  lastEvents: number
  aggCursors: Map<number, number>
  snapshotFrameRow: number
  snapshotSeq: number
}

// All session state lives outside React; components subscribe via
// useSyncExternalStore on a version counter and read fields directly. The
// canvas components bypass React entirely and read tracks/frames in their
// own rAF loops. Ingestion mutates freely; notification is throttled to the
// stats tick so React renders at ~5Hz regardless of event rate.
class SessionStore {
  readonly sessions = new Map<number, Session>()
  readonly order: number[] = []
  serverState: AuspexServerState = { listening: false, host: '', port: 0, error: null }
  demoRunning = false
  version = 0

  private readonly listeners = new Set<() => void>()
  private dirty = false
  private started = false
  onSessionOpened: ((id: number) => void) | null = null

  start(): void {
    if (this.started) return
    this.started = true

    window.auspex.onServerState(state => {
      this.serverState = state
      this.markDirty()
    })
    window.auspex.onDemoState(state => {
      this.demoRunning = state.running
      this.notify()
    })
    window.auspex.onSessionEvent(event => {
      if (event.type === 'open') this.open(event.id)
      else if (event.type === 'data') this.ingest(event.id, event.chunk)
      else this.close(event.id)
    })
    setInterval(() => this.tick(), TICK_MS)
    window.auspex.ready()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion = (): number => this.version

  closeTab(id: number): void {
    const session = this.sessions.get(id)
    if (!session || session.status !== 'closed') return
    this.sessions.delete(id)
    const index = this.order.indexOf(id)
    if (index >= 0) this.order.splice(index, 1)
    this.notify()
  }

  private open(id: number): void {
    const session: Session = {
      id,
      status: 'handshaking',
      name: null,
      pid: null,
      startMs: null,
      tsFreq: 1_000_000,
      strings: new Map(),
      threads: new Map(),
      counters: new Map(),
      markers: [],
      tracks: new Map(),
      frames: new FrameIndex(),
      snapshots: [],
      maxTs: 0,
      budgetUs: 16_667,
      framesTotal: 0,
      zones: 0,
      events: 0,
      eventsRate: 0,
      fps: 0,
      parseErrors: 0,
      parser: null as unknown as WireParser,
      mainTid: null,
      fmTimes: [],
      lastEvents: 0,
      aggCursors: new Map(),
      snapshotFrameRow: 0,
      snapshotSeq: 0,
    }
    session.parser = new WireParser({
      control: msg => this.applyControl(session, msg),
      zoneBegin: (tid, ts, nameId) => {
        session.events++
        session.zones++
        this.track(session, tid).begin(ts, nameId)
        this.bumpThread(session, tid)
        this.bumpTime(session, ts)
      },
      zoneEnd: (tid, ts) => {
        session.events++
        this.track(session, tid).finish(ts)
        this.bumpThread(session, tid)
        this.bumpTime(session, ts)
      },
      frameMark: (tid, ts, frame) => {
        session.events++
        this.applyFrameMark(session, tid, ts, frame)
      },
      counter: (ts, nameId, value) => {
        session.events++
        let counter = session.counters.get(nameId)
        if (!counter) {
          counter = {
            nameId,
            name: session.strings.get(nameId) ?? `#${nameId}`,
            latest: value,
            series: new CounterSeries(),
          }
          session.counters.set(nameId, counter)
        }
        counter.latest = value
        counter.series.push(ts, value)
        this.bumpTime(session, ts)
      },
      marker: (tid, ts, nameId) => {
        session.events++
        session.markers.push({
          tsUs: ts,
          tid,
          name: session.strings.get(nameId) ?? `#${nameId}`,
        })
        if (session.markers.length > MARKER_CAP) session.markers.shift()
        this.bumpThread(session, tid)
        this.bumpTime(session, ts)
      },
      error: () => {
        session.parseErrors++
      },
    })
    this.sessions.set(id, session)
    this.order.push(id)
    this.notify()
    this.onSessionOpened?.(id)
  }

  private close(id: number): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.status = 'closed'
    // Rates describe "now"; freeze cumulative stats but zero the rate so a
    // dead session does not display its final in-flight rate forever.
    session.eventsRate = 0
    this.notify()
  }

  private ingest(id: number, chunk: Uint8Array): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.parser.push(chunk)
    this.markDirty()
  }

  private track(session: Session, tid: number): Track {
    let track = session.tracks.get(tid)
    if (!track) {
      track = new Track()
      session.tracks.set(tid, track)
    }
    return track
  }

  private applyControl(session: Session, msg: ControlMsg): void {
    session.events++
    switch (msg.t) {
      case 'hello':
        session.name = msg.name
        session.pid = msg.pid
        session.startMs = msg.start
        session.tsFreq = msg.tsFreq
        // The budget is a declared contract, not an estimate: the producer's
        // target fps, defaulting to 60. Static by construction.
        session.budgetUs = 1_000_000 / (msg.fps && msg.fps > 0 ? msg.fps : 60)
        if (session.status === 'handshaking') session.status = 'live'
        break
      case 'str':
        session.strings.set(msg.id, msg.s)
        break
      case 'thread':
        session.threads.set(msg.tid, {
          tid: msg.tid,
          name: session.strings.get(msg.name) ?? `#${msg.name}`,
          events: 0,
        })
        break
    }
  }

  private applyFrameMark(session: Session, tid: number, tsUs: number, frame: number): void {
    if (session.mainTid === null) session.mainTid = tid
    this.track(session, tid).markFrame(tsUs)
    if (tid === session.mainTid) {
      for (const [otherTid, track] of session.tracks) {
        if (otherTid !== tid) track.adoptFrame(tsUs)
      }
      session.framesTotal = Math.max(session.framesTotal, frame + 1)
      session.fmTimes.push(tsUs)
      if (session.fmTimes.length > FM_WINDOW) session.fmTimes.shift()
      session.frames.push(tsUs, frame)
    }
    this.bumpThread(session, tid)
    this.bumpTime(session, tsUs)
  }

  private bumpThread(session: Session, tid: number): void {
    const thread = session.threads.get(tid)
    if (thread) thread.events++
  }

  private bumpTime(session: Session, tsUs: number): void {
    if (tsUs > session.maxTs) session.maxTs = tsUs
  }

  private tick(): void {
    for (const session of this.sessions.values()) {
      session.eventsRate = ((session.events - session.lastEvents) * 1000) / TICK_MS
      session.lastEvents = session.events
      const times = session.fmTimes
      if (times.length >= 2) {
        const first = times[0]
        const last = times[times.length - 1]
        const spanSec = (last - first) / session.tsFreq
        session.fps = spanSec > 0 ? (times.length - 1) / spanSec : 0
      }
      this.maybeSnapshot(session)
      for (const track of session.tracks.values()) track.trim(MAX_TRACK_ROWS)
      for (const counter of session.counters.values()) counter.series.trim(MAX_COUNTER_ROWS)
      session.frames.trim(MAX_FRAME_ROWS)
      if (session.status === 'live') this.dirty = true
    }
    if (this.dirty) this.notify()
  }

  // Closes aggregation windows of SNAPSHOT_FRAMES main-thread frames and
  // computes per-zone-name stats (count/avg/self/max) across all threads.
  private maybeSnapshot(session: Session): void {
    const frames = session.frames
    if (session.snapshotFrameRow < frames.firstRow) session.snapshotFrameRow = frames.firstRow
    while (frames.length - 1 - session.snapshotFrameRow >= SNAPSHOT_FRAMES) {
      const fromRow = session.snapshotFrameRow
      const toRow = fromRow + SNAPSHOT_FRAMES
      const startUs = frames.start.get(fromRow)
      const endUs = frames.start.get(toRow)
      session.snapshotFrameRow = toRow

      let frameMax = 0
      let frameTotal = 0
      for (let row = fromRow; row < toRow; row++) {
        const duration = frames.durationUs.get(row)
        frameTotal += duration
        if (duration > frameMax) frameMax = duration
      }

      const { zones, shape } = this.aggregateZones(session, endUs, SNAPSHOT_FRAMES)
      session.snapshots.push({
        seq: session.snapshotSeq++,
        startUs,
        endUs,
        frames: SNAPSHOT_FRAMES,
        fps: (SNAPSHOT_FRAMES * 1_000_000) / (endUs - startUs),
        frameAvgUs: frameTotal / SNAPSHOT_FRAMES,
        frameMaxUs: frameMax,
        budgetUs: session.budgetUs,
        zones,
        shape,
      })
      if (session.snapshots.length > SNAPSHOT_CAP) session.snapshots.shift()
      this.dirty = true
    }
  }

  // Walks each track's rows from its aggregation cursor up to windowEndUs,
  // reconstructing nesting from begin-order + known ends to attribute
  // self-time (zone minus children), and accumulating the average-frame
  // shape (mean in-frame offset and duration per zone identity). A
  // still-open zone stalls that track's cursor; its rows fold into a later
  // snapshot once it closes. Zones are attributed to the window where they
  // began.
  private aggregateZones(
    session: Session,
    windowEndUs: number,
    frameCount: number,
  ): { zones: ZoneStat[]; shape: FrameShapeZone[] } {
    const stats = new Map<number, ZoneStat>()
    const record = (nameId: number, durationUs: number, selfUs: number) => {
      let stat = stats.get(nameId)
      if (!stat) {
        stat = {
          nameId,
          name: session.strings.get(nameId) ?? `#${nameId}`,
          count: 0,
          totalUs: 0,
          selfUs: 0,
          maxUs: 0,
        }
        stats.set(nameId, stat)
      }
      stat.count++
      stat.totalUs += durationUs
      stat.selfUs += selfUs
      if (durationUs > stat.maxUs) stat.maxUs = durationUs
    }

    type ShapeAcc = { tid: number; depth: number; nameId: number; sumOffset: number; sumDur: number; count: number }
    const shapeAcc = new Map<string, ShapeAcc>()

    for (const [tid, track] of session.tracks) {
      let row = session.aggCursors.get(tid) ?? track.firstRow
      if (row < track.firstRow) row = track.firstRow
      const stack: { endUs: number; nameId: number; durationUs: number; childUs: number }[] = []
      const pop = () => {
        const top = stack.pop()!
        record(top.nameId, top.durationUs, top.durationUs - top.childUs)
        if (stack.length > 0) stack[stack.length - 1].childUs += top.durationUs
      }
      for (; row < track.length; row++) {
        const start = track.start.get(row)
        if (start >= windowEndUs) break
        const end = track.end.get(row)
        if (end === OPEN_END) break
        const nameId = track.name.get(row)
        while (stack.length > 0 && stack[stack.length - 1].endUs <= start) pop()
        stack.push({ endUs: end, nameId, durationUs: end - start, childUs: 0 })

        const offset = track.offset.get(row)
        if (offset >= 0) {
          const depth = track.depth.get(row)
          const key = `${tid}:${depth}:${nameId}`
          let acc = shapeAcc.get(key)
          if (!acc) {
            acc = { tid, depth, nameId, sumOffset: 0, sumDur: 0, count: 0 }
            shapeAcc.set(key, acc)
          }
          acc.sumOffset += offset
          acc.sumDur += end - start
          acc.count++
        }
      }
      while (stack.length > 0) pop()
      session.aggCursors.set(tid, row)
    }

    const shape = [...shapeAcc.values()].map(acc => ({
      tid: acc.tid,
      depth: acc.depth,
      nameId: acc.nameId,
      name: session.strings.get(acc.nameId) ?? `#${acc.nameId}`,
      avgOffsetUs: acc.sumOffset / acc.count,
      avgDurUs: acc.sumDur / acc.count,
      perFrame: acc.count / frameCount,
    }))
    shape.sort((a, b) => a.tid - b.tid || a.depth - b.depth || a.avgOffsetUs - b.avgOffsetUs)

    return {
      zones: [...stats.values()].sort((a, b) => b.selfUs - a.selfUs).slice(0, SNAPSHOT_ZONE_CAP),
      shape,
    }
  }

  private markDirty(): void {
    this.dirty = true
  }

  private notify(): void {
    this.dirty = false
    this.version++
    for (const listener of this.listeners) listener()
  }
}

export const store = new SessionStore()

// Debug handle for devtools/CDP poking; this is a dev tool, no secrets here.
;(window as unknown as { __auspex: SessionStore }).__auspex = store
