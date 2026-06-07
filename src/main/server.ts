import { createServer, type Server, type Socket } from 'node:net'
import type { WebContents } from 'electron'
import { DEFAULT_PORT } from '../shared/protocol'

// Interim replay buffer cap per session. The renderer rebuilds all session
// state from replayed bytes after an HMR reload; once the columnar store and
// real retention land viewer-side, this buffer shrinks to control-plane state
// plus a short tail.
const MAX_BUFFER_BYTES = 64 * 1024 * 1024

export type ServerState = {
  listening: boolean
  host: string
  port: number
  error: string | null
}

export type SessionEvent =
  | { type: 'open'; id: number }
  | { type: 'data'; id: number; chunk: Uint8Array }
  | { type: 'close'; id: number }

type SessionRecord = {
  id: number
  socket: Socket
  chunks: Buffer[]
  bytes: number
  truncated: boolean
  open: boolean
}

// Owns the listening socket. Deliberately knows nothing about the protocol
// beyond "bytes per connection": all parsing lives renderer-side so the wire
// format can change without touching the main process.
export class ProfilerServer {
  private server: Server | null = null
  private readonly sessions = new Map<number, SessionRecord>()
  private nextId = 1
  private webContents: WebContents | null = null
  private rendererReady = false
  private state: ServerState

  constructor(
    private readonly host = '127.0.0.1',
    private readonly port = DEFAULT_PORT,
  ) {
    this.state = { listening: false, host, port, error: null }
  }

  start(): void {
    const server = createServer(socket => this.accept(socket))
    this.server = server
    server.on('error', (error: NodeJS.ErrnoException) => {
      this.state = { ...this.state, listening: false, error: error.code ?? error.message }
      this.sendState()
    })
    server.listen(this.port, this.host, () => {
      this.state = { ...this.state, listening: true, error: null }
      this.sendState()
    })
  }

  attach(webContents: WebContents): void {
    this.webContents = webContents
    this.rendererReady = false
  }

  // Called by the renderer on every mount (including HMR reloads): replays
  // buffered session bytes so the renderer can rebuild its state from scratch.
  onRendererReady(): void {
    this.rendererReady = true
    this.sendState()
    for (const session of this.sessions.values()) {
      this.send({ type: 'open', id: session.id })
      if (session.bytes > 0) {
        this.send({ type: 'data', id: session.id, chunk: Buffer.concat(session.chunks) })
      }
      if (!session.open) this.send({ type: 'close', id: session.id })
    }
  }

  stop(): void {
    this.server?.close()
    for (const session of this.sessions.values()) session.socket.destroy()
  }

  private accept(socket: Socket): void {
    const session: SessionRecord = {
      id: this.nextId++,
      socket,
      chunks: [],
      bytes: 0,
      truncated: false,
      open: true,
    }
    this.sessions.set(session.id, session)
    socket.setNoDelay(true)
    this.send({ type: 'open', id: session.id })

    socket.on('data', (chunk: Buffer) => {
      if (session.bytes + chunk.length <= MAX_BUFFER_BYTES) {
        session.chunks.push(chunk)
        session.bytes += chunk.length
      } else {
        session.truncated = true
      }
      this.send({ type: 'data', id: session.id, chunk })
    })
    socket.on('error', () => {})
    socket.on('close', () => {
      session.open = false
      this.send({ type: 'close', id: session.id })
    })
  }

  private send(event: SessionEvent): void {
    if (!this.rendererReady || !this.webContents || this.webContents.isDestroyed()) return
    this.webContents.send('auspex:session', event)
  }

  private sendState(): void {
    if (!this.webContents || this.webContents.isDestroyed()) return
    this.webContents.send('auspex:server-state', this.state)
  }
}
