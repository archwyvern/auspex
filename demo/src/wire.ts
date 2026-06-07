import type { Socket } from 'node:net'
import {
  FRAME_CONTROL,
  FRAME_DATA,
  REC_CTR,
  REC_FM,
  REC_MK,
  REC_ZB,
  REC_ZE,
  type ControlMsg,
} from '../../src/shared/protocol'

// Builds one network write per flush: queued control frames (JSON) followed
// by a single data frame of packed records. Mirrors what the real SDK's
// sender thread will do — the ring buffer contents essentially are the wire
// format.
export class WireWriter {
  private controls: Buffer[] = []
  private buf = Buffer.allocUnsafe(64 * 1024)
  private off = 0

  control(msg: ControlMsg): void {
    const json = Buffer.from(JSON.stringify(msg), 'utf8')
    const head = Buffer.allocUnsafe(5)
    head.writeUInt32LE(json.length + 1, 0)
    head.writeUInt8(FRAME_CONTROL, 4)
    this.controls.push(head, json)
  }

  private ensure(bytes: number): void {
    if (this.off + bytes <= this.buf.length) return
    const grown = Buffer.allocUnsafe(this.buf.length * 2)
    this.buf.copy(grown, 0, 0, this.off)
    this.buf = grown
  }

  zoneBegin(tid: number, tsUs: number, nameId: number): void {
    this.ensure(14)
    this.buf.writeUInt8(REC_ZB, this.off)
    this.buf.writeUInt8(tid, this.off + 1)
    this.buf.writeDoubleLE(tsUs, this.off + 2)
    this.buf.writeUInt32LE(nameId, this.off + 10)
    this.off += 14
  }

  zoneEnd(tid: number, tsUs: number): void {
    this.ensure(10)
    this.buf.writeUInt8(REC_ZE, this.off)
    this.buf.writeUInt8(tid, this.off + 1)
    this.buf.writeDoubleLE(tsUs, this.off + 2)
    this.off += 10
  }

  frameMark(tid: number, tsUs: number, frame: number): void {
    this.ensure(14)
    this.buf.writeUInt8(REC_FM, this.off)
    this.buf.writeUInt8(tid, this.off + 1)
    this.buf.writeDoubleLE(tsUs, this.off + 2)
    this.buf.writeUInt32LE(frame, this.off + 10)
    this.off += 14
  }

  counter(tsUs: number, nameId: number, value: number): void {
    this.ensure(22)
    this.buf.writeUInt8(REC_CTR, this.off)
    this.buf.writeUInt8(0, this.off + 1)
    this.buf.writeDoubleLE(tsUs, this.off + 2)
    this.buf.writeUInt32LE(nameId, this.off + 10)
    this.buf.writeDoubleLE(value, this.off + 14)
    this.off += 22
  }

  marker(tid: number, tsUs: number, nameId: number): void {
    this.ensure(14)
    this.buf.writeUInt8(REC_MK, this.off)
    this.buf.writeUInt8(tid, this.off + 1)
    this.buf.writeDoubleLE(tsUs, this.off + 2)
    this.buf.writeUInt32LE(nameId, this.off + 10)
    this.off += 14
  }

  flush(socket: Socket): void {
    const chunks = this.controls
    this.controls = []
    if (this.off > 0) {
      const head = Buffer.allocUnsafe(5)
      head.writeUInt32LE(this.off + 1, 0)
      head.writeUInt8(FRAME_DATA, 4)
      chunks.push(head, Buffer.from(this.buf.subarray(0, this.off)))
      this.off = 0
    }
    if (chunks.length > 0) socket.write(Buffer.concat(chunks))
  }
}
