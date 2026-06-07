// Auspex wire protocol v1 (alpha — mutable while both endpoints live in this
// repo; hardening checkpoint is the first externally-shipped SDK).
//
// Transport: TCP, producer dials the profiler. Stream of length-prefixed
// frames:
//
//   [u32 LE length] [u8 frameType] [payload: length-1 bytes]
//
// frameType 0 (control): payload is one UTF-8 JSON message — hello, string
//   interning, thread declarations. Rare, self-describing, evolvable.
// frameType 1 (data): payload is a sequence of packed little-endian records
//   (the four hot primitives). The hello carries a record-size table so
//   consumers can skip record types they don't know.
//
// Timestamps are f64 microseconds since session start (tsFreq declares the
// unit). Event order is monotonic per thread, NOT globally across threads.
// Zone nesting is implicit in per-thread begin/end ordering.

export const DEFAULT_PORT = 6502

export const FRAME_CONTROL = 0
export const FRAME_DATA = 1

// Data-plane record types and layouts (offsets after the leading type byte):
//   ZB : u8 tid, f64 ts, u32 nameId            -> 14 bytes
//   ZE : u8 tid, f64 ts                        -> 10 bytes
//   FM : u8 tid, f64 ts, u32 frame             -> 14 bytes
//   CTR: u8 pad, f64 ts, u32 nameId, f64 value -> 22 bytes
//   MK : u8 tid, f64 ts, u32 nameId            -> 14 bytes
export const REC_ZB = 1
export const REC_ZE = 2
export const REC_FM = 3
export const REC_CTR = 4
export const REC_MK = 5

export const REC_SIZES: Record<number, number> = {
  [REC_ZB]: 14,
  [REC_ZE]: 10,
  [REC_FM]: 14,
  [REC_CTR]: 22,
  [REC_MK]: 14,
}

export type HelloMsg = {
  t: 'hello'
  v: 1
  pid: number
  name: string
  start: number // wall-clock epoch ms of session start
  tsFreq: number // timestamp ticks per second
  // Declared target frame rate; drives the frame budget (gold line, frame-bar
  // colors, axis scaling). Viewer defaults to 60 when absent.
  fps?: number
  // Record-size table: lets consumers skip unknown data-plane record types.
  sizes?: Record<number, number>
}

export type StringMsg = { t: 'str'; id: number; s: string }
export type ThreadMsg = { t: 'thread'; tid: number; name: number }

export type ControlMsg = HelloMsg | StringMsg | ThreadMsg

// Per-connection string table; emits a 'str' control message the first time
// a string is seen.
export class StringTable {
  private readonly ids = new Map<string, number>()
  private next = 1

  constructor(private readonly emit: (msg: StringMsg) => void) {}

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
