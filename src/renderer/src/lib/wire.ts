import {
  FRAME_CONTROL,
  FRAME_DATA,
  REC_CTR,
  REC_FM,
  REC_MK,
  REC_SIZES,
  REC_ZB,
  REC_ZE,
  type ControlMsg,
} from '../../../shared/protocol'

export type WireHandlers = {
  control: (msg: ControlMsg) => void
  zoneBegin: (tid: number, tsUs: number, nameId: number) => void
  zoneEnd: (tid: number, tsUs: number) => void
  frameMark: (tid: number, tsUs: number, frame: number) => void
  counter: (tsUs: number, nameId: number, value: number) => void
  marker: (tid: number, tsUs: number, nameId: number) => void
  error: () => void
}

const decoder = new TextDecoder()

// Per-session stream parser: reassembles length-prefixed frames across TCP
// chunk boundaries and decodes records straight into handler calls — no
// per-event objects on the hot path. Unknown record types are skipped via
// the hello's size table (forward compatibility); unknown without a size
// aborts the frame (frame boundaries make resync automatic).
export class WireParser {
  private pending: Uint8Array | null = null
  private sizes: Record<number, number> = { ...REC_SIZES }

  constructor(private readonly handlers: WireHandlers) {}

  push(chunk: Uint8Array): void {
    let data: Uint8Array
    if (this.pending) {
      data = new Uint8Array(this.pending.length + chunk.length)
      data.set(this.pending, 0)
      data.set(chunk, this.pending.length)
    } else {
      data = chunk
    }

    let offset = 0
    while (data.length - offset >= 4) {
      const view = new DataView(data.buffer, data.byteOffset + offset)
      const length = view.getUint32(0, true)
      if (data.length - offset - 4 < length || length < 1) {
        if (length < 1) {
          this.handlers.error()
          offset = data.length
        }
        break
      }
      const frameType = view.getUint8(4)
      if (frameType === FRAME_CONTROL) {
        try {
          const msg = JSON.parse(
            decoder.decode(data.subarray(offset + 5, offset + 4 + length)),
          ) as ControlMsg
          if (msg.t === 'hello' && msg.sizes) this.sizes = { ...REC_SIZES, ...msg.sizes }
          this.handlers.control(msg)
        } catch {
          this.handlers.error()
        }
      } else if (frameType === FRAME_DATA) {
        this.parseRecords(data, offset + 5, length - 1)
      } else {
        this.handlers.error()
      }
      offset += 4 + length
    }

    this.pending = offset < data.length ? data.slice(offset) : null
  }

  private parseRecords(data: Uint8Array, start: number, length: number): void {
    const h = this.handlers
    const view = new DataView(data.buffer, data.byteOffset + start, length)
    let off = 0
    while (off < length) {
      const type = view.getUint8(off)
      const size = this.sizes[type]
      if (size === undefined || off + size > length) {
        h.error()
        return
      }
      switch (type) {
        case REC_ZB:
          h.zoneBegin(view.getUint8(off + 1), view.getFloat64(off + 2, true), view.getUint32(off + 10, true))
          break
        case REC_ZE:
          h.zoneEnd(view.getUint8(off + 1), view.getFloat64(off + 2, true))
          break
        case REC_FM:
          h.frameMark(view.getUint8(off + 1), view.getFloat64(off + 2, true), view.getUint32(off + 10, true))
          break
        case REC_CTR:
          h.counter(view.getFloat64(off + 2, true), view.getUint32(off + 10, true), view.getFloat64(off + 14, true))
          break
        case REC_MK:
          h.marker(view.getUint8(off + 1), view.getFloat64(off + 2, true), view.getUint32(off + 10, true))
          break
        // Unknown-but-sized record types are silently skipped.
      }
      off += size
    }
  }
}
