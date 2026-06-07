// Columnar storage for the hot data: zones and frames live in chunked typed
// arrays, never as per-event JS objects, so a multi-minute session is a few
// flat buffers the GC ignores. Chunks also make head-trimming (ring
// retention) a pointer shift instead of a copy.

const CHUNK_SHIFT = 16
const CHUNK_SIZE = 1 << CHUNK_SHIFT
const CHUNK_MASK = CHUNK_SIZE - 1

class ChunkedColumn<A extends Float64Array | Uint32Array> {
  protected readonly chunks: A[] = []
  protected head = 0 // rows trimmed off the front, always a chunk multiple

  constructor(private readonly make: (size: number) => A) {}

  push(rowIndex: number, value: number): void {
    const chunk = (rowIndex - this.head) >> CHUNK_SHIFT
    if (chunk >= this.chunks.length) this.chunks.push(this.make(CHUNK_SIZE))
    this.chunks[chunk][rowIndex & CHUNK_MASK] = value
  }

  get(rowIndex: number): number {
    return this.chunks[(rowIndex - this.head) >> CHUNK_SHIFT][rowIndex & CHUNK_MASK]
  }

  set(rowIndex: number, value: number): void {
    this.chunks[(rowIndex - this.head) >> CHUNK_SHIFT][rowIndex & CHUNK_MASK] = value
  }

  dropHeadChunk(): void {
    this.chunks.shift()
    this.head += CHUNK_SIZE
  }
}

const f64 = (size: number) => new Float64Array(size)
const u32 = (size: number) => new Uint32Array(size)

export const OPEN_END = -1

// Zones for one thread, in begin order (which is start-time order per
// thread). `end` is OPEN_END until the matching ze arrives, so in-progress
// zones render live.
export class Track {
  readonly start = new ChunkedColumn(f64)
  readonly end = new ChunkedColumn(f64)
  readonly name = new ChunkedColumn(u32)
  readonly depth = new ChunkedColumn(u32)
  // Offset of the zone's start within its thread's current frame (-1 before
  // the first frame mark). Written at ingest so the average-frame view can
  // aggregate without re-walking frame boundaries.
  readonly offset = new ChunkedColumn(f64)
  firstRow = 0
  length = 0
  maxDepth = 0
  maxDurationUs = 0
  frameStartUs = -1
  hasOwnFrameMarks = false

  private readonly openStack: number[] = []

  markFrame(tsUs: number): void {
    this.frameStartUs = tsUs
    this.hasOwnFrameMarks = true
  }

  // Threads that never mark frames themselves (job workers) inherit the main
  // thread's frame starts so their zones still get in-frame offsets.
  adoptFrame(tsUs: number): void {
    if (!this.hasOwnFrameMarks) this.frameStartUs = tsUs
  }

  begin(tsUs: number, nameId: number): void {
    const row = this.length++
    this.start.push(row, tsUs)
    this.end.push(row, OPEN_END)
    this.name.push(row, nameId)
    this.depth.push(row, this.openStack.length)
    this.offset.push(row, this.frameStartUs >= 0 ? tsUs - this.frameStartUs : -1)
    if (this.openStack.length > this.maxDepth) this.maxDepth = this.openStack.length
    this.openStack.push(row)
  }

  finish(tsUs: number): void {
    const row = this.openStack.pop()
    if (row === undefined) return
    this.end.set(row, tsUs)
    const duration = tsUs - this.start.get(row)
    if (duration > this.maxDurationUs) this.maxDurationUs = duration
  }

  // First row whose zone could overlap [fromUs, ...): binary search on start
  // (sorted), backed off by the longest zone ever seen on this track.
  firstVisible(fromUs: number): number {
    const target = fromUs - this.maxDurationUs
    let lo = this.firstRow
    let hi = this.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.start.get(mid) < target) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  // Ring retention: drop whole head chunks beyond maxRows, never trimming
  // into rows still referenced by the open-zone stack.
  trim(maxRows: number): void {
    const oldestOpen = this.openStack.length > 0 ? this.openStack[0] : this.length
    while (
      this.length - this.firstRow > maxRows &&
      this.firstRow + CHUNK_SIZE <= oldestOpen
    ) {
      this.start.dropHeadChunk()
      this.end.dropHeadChunk()
      this.name.dropHeadChunk()
      this.depth.dropHeadChunk()
      this.offset.dropHeadChunk()
      this.firstRow += CHUNK_SIZE
    }
  }
}

// Time series for one counter: instant samples, plotted as a line lane under
// the thread tracks. Running min/max give a stable y-scale.
export class CounterSeries {
  readonly ts = new ChunkedColumn(f64)
  readonly value = new ChunkedColumn(f64)
  firstRow = 0
  length = 0
  min = Infinity
  max = -Infinity

  push(tsUs: number, value: number): void {
    const row = this.length++
    this.ts.push(row, tsUs)
    this.value.push(row, value)
    if (value < this.min) this.min = value
    if (value > this.max) this.max = value
  }

  // First row at or after fromUs, minus one so the line enters from the left
  // edge instead of starting mid-view.
  firstVisible(fromUs: number): number {
    let lo = this.firstRow
    let hi = this.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.ts.get(mid) < fromUs) lo = mid + 1
      else hi = mid
    }
    return Math.max(this.firstRow, lo - 1)
  }

  trim(maxRows: number): void {
    while (this.length - this.firstRow > maxRows && this.length - this.firstRow >= CHUNK_SIZE) {
      this.ts.dropHeadChunk()
      this.value.dropHeadChunk()
      this.firstRow += CHUNK_SIZE
    }
  }
}

// Frame boundaries on the main thread. A frame's duration is patched when the
// next mark arrives; the latest frame stays open (-1).
export class FrameIndex {
  readonly start = new ChunkedColumn(f64)
  readonly durationUs = new ChunkedColumn(f64)
  readonly number = new ChunkedColumn(u32)
  firstRow = 0
  length = 0

  push(tsUs: number, frameNumber: number): void {
    if (this.length > this.firstRow) {
      const prev = this.length - 1
      this.durationUs.set(prev, tsUs - this.start.get(prev))
    }
    const row = this.length++
    this.start.push(row, tsUs)
    this.durationUs.push(row, OPEN_END)
    this.number.push(row, frameNumber)
  }

  trim(maxRows: number): void {
    while (this.length - this.firstRow > maxRows && this.length - this.firstRow >= CHUNK_SIZE) {
      this.start.dropHeadChunk()
      this.durationUs.dropHeadChunk()
      this.number.dropHeadChunk()
      this.firstRow += CHUNK_SIZE
    }
  }
}
