// Interim NDJSON-over-TCP protocol spoken by the demo producers while the
// binary wire format is unsettled. The semantics are the real model — hello,
// string interning, and the four primitives (zone begin/end, frame mark,
// counter, marker) — only the encoding is throwaway.
//
// Timestamps are microseconds since session start (tsFreq = 1e6). Event order
// is monotonic per thread, NOT globally across threads.

export const DEFAULT_PORT = 6502

export type HelloMsg = {
  t: 'hello'
  v: 1
  pid: number
  name: string
  start: number // wall-clock epoch ms of session start
  tsFreq: number // timestamp ticks per second
}

export type StringMsg = { t: 'str'; id: number; s: string }
export type ThreadMsg = { t: 'thread'; tid: number; name: number }
export type ZoneBeginMsg = { t: 'zb'; tid: number; ts: number; name: number }
export type ZoneEndMsg = { t: 'ze'; tid: number; ts: number }
export type FrameMarkMsg = { t: 'fm'; tid: number; ts: number; frame: number }
export type CounterMsg = { t: 'ctr'; ts: number; name: number; value: number }
export type MarkerMsg = { t: 'mk'; tid: number; ts: number; name: number }

export type Msg =
  | HelloMsg
  | StringMsg
  | ThreadMsg
  | ZoneBeginMsg
  | ZoneEndMsg
  | FrameMarkMsg
  | CounterMsg
  | MarkerMsg

// Per-connection string table; emits a 'str' message the first time a string
// is seen, mirroring how the binary wire will intern zone/counter names.
export class StringTable {
  private readonly ids = new Map<string, number>()
  private next = 1

  constructor(private readonly emit: (msg: Msg) => void) {}

  id(s: string): number {
    let id = this.ids.get(s)
    if (id === undefined) {
      id = this.next++
      this.ids.set(s, id)
      this.emit({ t: 'str', id, s })
    }
    return id
  }
}
