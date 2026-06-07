import type { Msg } from '../../../shared/protocol'

const MARKER_CAP = 100
const FM_WINDOW = 90
const TICK_MS = 200

export type ThreadInfo = {
  tid: number
  name: string
  events: number
}

export type MarkerEntry = {
  tsUs: number
  name: string
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
  counters: Map<string, number>
  markers: MarkerEntry[]
  frames: number
  zones: number
  events: number
  eventsRate: number
  fps: number
  parseErrors: number
  // internals
  decoder: TextDecoder
  carry: string
  mainTid: number | null
  fmTimes: number[]
  lastEvents: number
}

// All session state lives outside React; components subscribe via
// useSyncExternalStore on a version counter and read fields directly.
// Ingestion mutates freely; notification is throttled to the stats tick so
// React renders at ~5Hz regardless of event rate.
class SessionStore {
  readonly sessions = new Map<number, Session>()
  readonly order: number[] = []
  serverState: AuspexServerState = { listening: false, host: '', port: 0, error: null }
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
    this.sessions.set(id, {
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
      frames: 0,
      zones: 0,
      events: 0,
      eventsRate: 0,
      fps: 0,
      parseErrors: 0,
      decoder: new TextDecoder(),
      carry: '',
      mainTid: null,
      fmTimes: [],
      lastEvents: 0,
    })
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
    const text = session.carry + session.decoder.decode(chunk, { stream: true })
    const lines = text.split('\n')
    session.carry = lines.pop() ?? ''
    for (const line of lines) {
      if (!line) continue
      try {
        this.apply(session, JSON.parse(line) as Msg)
      } catch {
        session.parseErrors++
      }
    }
    this.markDirty()
  }

  private apply(session: Session, msg: Msg): void {
    session.events++
    switch (msg.t) {
      case 'hello':
        session.name = msg.name
        session.pid = msg.pid
        session.startMs = msg.start
        session.tsFreq = msg.tsFreq
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
      case 'fm':
        if (session.mainTid === null) session.mainTid = msg.tid
        if (msg.tid === session.mainTid) {
          session.frames = Math.max(session.frames, msg.frame + 1)
          session.fmTimes.push(msg.ts)
          if (session.fmTimes.length > FM_WINDOW) session.fmTimes.shift()
        }
        this.bumpThread(session, msg.tid)
        break
      case 'zb':
        session.zones++
        this.bumpThread(session, msg.tid)
        break
      case 'ze':
        this.bumpThread(session, msg.tid)
        break
      case 'ctr':
        session.counters.set(session.strings.get(msg.name) ?? `#${msg.name}`, msg.value)
        break
      case 'mk':
        session.markers.push({ tsUs: msg.ts, name: session.strings.get(msg.name) ?? `#${msg.name}` })
        if (session.markers.length > MARKER_CAP) session.markers.shift()
        this.bumpThread(session, msg.tid)
        break
    }
  }

  private bumpThread(session: Session, tid: number): void {
    const thread = session.threads.get(tid)
    if (thread) thread.events++
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
      if (session.status === 'live') this.dirty = true
    }
    if (this.dirty) this.notify()
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
