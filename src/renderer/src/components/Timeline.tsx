import { memo, useEffect, useRef, useState } from 'react'
import type { Session, Snapshot } from '../lib/store'
import { OPEN_END } from '../lib/columns'
import {
  counterColor,
  formatCounterValue,
  formatDuration,
  formatTick,
  niceCeil,
  tickStep,
  useCanvasLoop,
  zoneColor,
} from '../lib/canvas'
import { Kbd } from './Kbd'

const GUTTER = 110
const RULER_H = 22
const LANE_H = 16
const TRACK_PAD = 5
const COUNTER_LANE_H = 40
const COUNTER_PLOT_PAD = 4
const COUNTER_TRAIL_US = 30_000_000
const MIN_SPAN_US = 200
const MAX_SPAN_US = 120_000_000
const DEFAULT_WINDOW_US = 250_000

export type TimelineController = {
  // Jump to ONE mode, paused on a specific frame (frame-bar clicks).
  pinFrame: (startUs: number, endUs: number) => void
}

type TimelineProps = {
  session: Session
  controllerRef: React.MutableRefObject<TimelineController | null>
  // The aggregate window the AVG view renders — latest, or a frozen one held
  // by SessionView so the waterfall and the zones table freeze together.
  snapshot: Snapshot | null
  frozen: boolean
  onToggleFreeze: () => void
  // Arrow stepping through snapshot history in AVG mode (owned by
  // SessionView alongside the freeze state).
  onStepSnapshot: (delta: number) => void
}

type Mode = 'avg' | 'one' | 'raw'

type ViewState = {
  startUs: number
  endUs: number
  follow: boolean
  windowUs: number
}

type FrameRef = { startUs: number; endUs: number }

// Three faces of the same data. AVG (default): a static average-frame
// picture over the last snapshot window — x is time within the frame;
// space freezes the snapshot. ONE: the latest actual frame on the same
// stable in-frame axis, advancing as frames complete; space freezes on the
// current frame, and frame-bar clicks land here pinned. RAW: the absolute-
// time waterfall with follow/pause, zoom, and pan.
export const Timeline = memo(
  function Timeline({
    session,
    controllerRef,
    snapshot,
    frozen,
    onToggleFreeze,
    onStepSnapshot,
  }: TimelineProps) {
    const view = useRef<ViewState>({
      startUs: 0,
      endUs: DEFAULT_WINDOW_US,
      follow: true,
      windowUs: DEFAULT_WINDOW_US,
    })
    const mouse = useRef<{ x: number; y: number } | null>(null)
    const drag = useRef<{ lastX: number } | null>(null)
    const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
    const lastTooltipText = useRef<string>('')
    const [following, setFollowing] = useState(true)
    const [mode, setMode] = useState<Mode>('avg')
    const modeRef = useRef<Mode>(mode)
    modeRef.current = mode
    const toggleFreezeRef = useRef(onToggleFreeze)
    toggleFreezeRef.current = onToggleFreeze
    const stepSnapshotRef = useRef(onStepSnapshot)
    stepSnapshotRef.current = onStepSnapshot
    const [oneFrozen, setOneFrozen] = useState(false)
    const oneFrame = useRef<FrameRef | null>(null)
    const latestFrame = useRef<FrameRef | null>(null)
    // Sticky axis windows: grow immediately when content doesn't fit, shrink
    // only when the target drops well below — kills flapping between
    // adjacent nice-value steps as averages wobble.
    const avgWindowUs = useRef(0)
    const oneWindowUs = useRef(0)

    const stickyWindow = (ref: React.MutableRefObject<number>, targetUs: number): number => {
      if (targetUs > ref.current || targetUs < ref.current * 0.55) ref.current = targetUs
      return ref.current
    }

    controllerRef.current = {
      pinFrame: (startUs, endUs) => {
        oneFrame.current = { startUs, endUs }
        setOneFrozen(true)
        setMode('one')
      },
    }

    const frameRefAt = (row: number): FrameRef | null => {
      const frames = session.frames
      if (row < frames.firstRow || row > frames.length - 2) return null
      const startUs = frames.start.get(row)
      const duration = frames.durationUs.get(row)
      if (duration === OPEN_END) return null
      return { startUs, endUs: startUs + duration }
    }

    // Arrow stepping in ONE mode: move to the adjacent frame; stepping past
    // the newest returns to live.
    const stepFrame = (delta: number) => {
      const frames = session.frames
      const base = oneFrame.current ?? latestFrame.current
      if (!base) return
      let lo = frames.firstRow
      let hi = frames.length
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (frames.start.get(mid) < base.startUs) lo = mid + 1
        else hi = mid
      }
      const row = lo + delta
      if (row > frames.length - 2) {
        oneFrame.current = null
        setOneFrozen(false)
        return
      }
      const next = frameRefAt(Math.max(frames.firstRow, row))
      if (!next) return
      oneFrame.current = next
      setOneFrozen(true)
    }

    useEffect(() => {
      const onKey = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
        if (event.ctrlKey || event.metaKey || event.altKey) return
        const current = modeRef.current

        if (event.code === 'Space') {
          event.preventDefault()
          if (current === 'avg') {
            toggleFreezeRef.current()
          } else if (current === 'one') {
            setOneFrozen(prev => {
              oneFrame.current = prev ? null : latestFrame.current
              return !prev
            })
          } else {
            const v = view.current
            v.follow = !v.follow
            if (v.follow) v.windowUs = Math.max(MIN_SPAN_US, v.endUs - v.startUs)
            setFollowing(v.follow)
          }
          return
        }

        if (event.code === 'Digit1' || event.code === 'Numpad1') {
          setMode('avg')
          return
        }
        if (event.code === 'Digit2' || event.code === 'Numpad2') {
          setMode('one')
          return
        }
        if (event.code === 'Digit3' || event.code === 'Numpad3') {
          setMode('raw')
          return
        }

        if (!event.code.startsWith('Arrow')) return
        event.preventDefault()
        if (current === 'avg') {
          if (event.code === 'ArrowLeft') stepSnapshotRef.current(-1)
          else if (event.code === 'ArrowRight') stepSnapshotRef.current(1)
        } else if (current === 'one') {
          if (event.code === 'ArrowLeft') stepFrame(-1)
          else if (event.code === 'ArrowRight') stepFrame(1)
        } else {
          const v = view.current
          const span = v.endUs - v.startUs
          if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
            const delta = (event.code === 'ArrowLeft' ? -1 : 1) * span * 0.25
            v.startUs += delta
            v.endUs += delta
            if (v.follow) {
              v.follow = false
              setFollowing(false)
            }
          } else {
            const factor = event.code === 'ArrowUp' ? 0.8 : 1.25
            const newSpan = Math.min(MAX_SPAN_US, Math.max(MIN_SPAN_US, span * factor))
            if (v.follow) {
              v.windowUs = newSpan
            } else {
              const center = v.startUs + span / 2
              v.startUs = center - newSpan / 2
              v.endUs = center + newSpan / 2
            }
          }
        }
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }, [])

    const canvasRef = useCanvasLoop((ctx, width, height) => {
      ctx.clearRect(0, 0, width, height)
      ctx.font = '12px "IBM Plex Mono", monospace'
      const hover = mouse.current
      let hit: string | null = null

      const drawRuler = (fromUs: number, toUs: number, scale: number, gridBottom: number, labelOffsetUs: number) => {
        const step = tickStep(1 / scale, 90)
        ctx.fillStyle = 'rgb(255 255 255 / 0.06)'
        ctx.fillRect(GUTTER, 0, width - GUTTER, RULER_H)
        // Ticks originate at the label origin (frame start in ONE mode), not
        // absolute session time — otherwise the grid lands at a different
        // distance from x=0 every frame.
        let tick = labelOffsetUs + Math.ceil((fromUs - labelOffsetUs) / step) * step
        while (tick <= toUs) {
          const x = GUTTER + (tick - fromUs) * scale
          ctx.fillStyle = 'rgb(255 255 255 / 0.12)'
          ctx.fillRect(x, 0, 1, gridBottom)
          ctx.fillStyle = '#d4d4d4'
          ctx.fillText(formatTick(tick - labelOffsetUs, step), x + 4, 15)
          tick += step
        }
      }

      // Thread tracks with real zones, shared by RAW and ONE. Two passes:
      // gutter labels first, then zones clipped to the plot region so zones
      // starting left of the view can't paint into the gutter. Rects are
      // snapped to whole pixels to stop sub-pixel shimmer while following.
      const drawThreadTracks = (fromUs: number, toUs: number, scale: number, nowUs: number) => {
        const tids = [...session.tracks.keys()].sort((a, b) => a - b)
        const tops: number[] = []
        let y = RULER_H + 4
        for (const tid of tids) {
          const track = session.tracks.get(tid)!
          const trackH = (track.maxDepth + 1) * LANE_H + TRACK_PAD * 2
          tops.push(y)
          ctx.fillStyle = '#d4d4d4'
          ctx.fillText(session.threads.get(tid)?.name ?? `tid ${tid}`, 8, y + 14)
          ctx.fillStyle = 'rgb(255 255 255 / 0.06)'
          ctx.fillRect(0, y + trackH, width, 1)
          y += trackH + 4
        }

        ctx.save()
        ctx.beginPath()
        ctx.rect(GUTTER, 0, width - GUTTER, height)
        ctx.clip()
        tids.forEach((tid, index) => {
          const track = session.tracks.get(tid)!
          const lanes = track.maxDepth + 1
          const trackH = lanes * LANE_H + TRACK_PAD * 2
          const top = tops[index]

          const lastX: number[] = new Array(lanes).fill(-Infinity)
          for (let row = track.firstVisible(fromUs); row < track.length; row++) {
            const start = track.start.get(row)
            if (start > toUs) break
            let end = track.end.get(row)
            const open = end === OPEN_END
            if (open) end = nowUs
            if (end < fromUs) continue
            const depth = track.depth.get(row)
            const x = GUTTER + (start - fromUs) * scale
            const w = (end - start) * scale
            if (w < 0.5 && x - lastX[depth] < 0.5) continue
            lastX[depth] = x
            const rx = Math.round(x)
            const rw = Math.max(Math.round(x + w) - rx, 1)
            const zy = top + TRACK_PAD + depth * LANE_H
            ctx.fillStyle = zoneColor(track.name.get(row))
            ctx.fillRect(rx, zy, rw, LANE_H - 2)
            if (open) {
              ctx.fillStyle = '#fbbf24'
              ctx.fillRect(rx + rw - 1.5, zy, 1.5, LANE_H - 2)
            }
            if (rw > 44) {
              const label = session.strings.get(track.name.get(row)) ?? ''
              const maxChars = Math.floor((rw - 8) / 7.3)
              if (maxChars >= 3) {
                ctx.fillStyle = '#f5f5f7'
                ctx.fillText(
                  label.length > maxChars ? label.slice(0, maxChars - 1) + '…' : label,
                  Math.max(rx, GUTTER) + 4,
                  zy + 12,
                )
              }
            }
            if (
              hover &&
              hover.x >= rx &&
              hover.x <= rx + rw &&
              hover.y >= zy &&
              hover.y <= zy + LANE_H - 2
            ) {
              const name = session.strings.get(track.name.get(row)) ?? '?'
              hit = `${name} — ${open ? `${formatDuration(end - start)} (open)` : formatDuration(end - start)}`
            }
          }

          ctx.fillStyle = 'rgb(251 191 36 / 0.85)'
          for (const marker of session.markers) {
            if (marker.tid !== tid || marker.tsUs < fromUs || marker.tsUs > toUs) continue
            const x = Math.round(GUTTER + (marker.tsUs - fromUs) * scale)
            ctx.fillRect(x, top + 1, 1, trackH - 2)
          }
        })
        ctx.restore()
        return y
      }

      const drawCounters = (fromUs: number, toUs: number, yStart: number) => {
        let y = yStart
        const scale = (width - GUTTER) / (toUs - fromUs)
        const counterInfos = [...session.counters.values()].sort((a, b) => a.name.localeCompare(b.name))
        for (const counter of counterInfos) {
          const series = counter.series
          const plotTop = y + COUNTER_PLOT_PAD
          const plotH = COUNTER_LANE_H - COUNTER_PLOT_PAD * 2
          const range = series.max - series.min
          const valueY = (value: number) =>
            range > 0 ? plotTop + plotH - ((value - series.min) / range) * plotH : plotTop + plotH / 2

          ctx.fillStyle = 'rgb(255 255 255 / 0.03)'
          ctx.fillRect(GUTTER, y, width - GUTTER, COUNTER_LANE_H)

          // Gutter value = the value at the window's end, not the live
          // latest — a frozen view must not show numbers from the future.
          let shownValue = counter.latest
          if (series.length > series.firstRow) {
            let lo = series.firstRow
            let hi = series.length
            while (lo < hi) {
              const mid = (lo + hi) >>> 1
              if (series.ts.get(mid) <= toUs) lo = mid + 1
              else hi = mid
            }
            if (lo > series.firstRow) shownValue = series.value.get(lo - 1)
          }
          ctx.fillStyle = '#d4d4d4'
          ctx.fillText(counter.name, 8, y + 16)
          ctx.fillStyle = '#fbbf24'
          ctx.fillText(formatCounterValue(shownValue), 8, y + 32)

          if (series.length > series.firstRow) {
            // Decimate to per-pixel min/max columns: a 30s window of a
            // high-rate counter is tens of thousands of points; stroking
            // them raw each rAF frame would dominate the render loop.
            ctx.save()
            ctx.beginPath()
            ctx.rect(GUTTER, y, width - GUTTER, COUNTER_LANE_H)
            ctx.clip()
            ctx.strokeStyle = counterColor(counter.nameId)
            ctx.lineWidth = 1.5
            ctx.beginPath()
            let hoverValue: number | null = null
            let bucketX = -1
            let bucketMin = 0
            let bucketMax = 0
            let started = false
            for (let row = series.firstVisible(fromUs); row < series.length; row++) {
              const ts = series.ts.get(row)
              const value = series.value.get(row)
              const px = Math.round(GUTTER + (ts - fromUs) * scale)
              const vy = valueY(value)
              if (!started) {
                ctx.moveTo(px, vy)
                started = true
                bucketX = px
                bucketMin = vy
                bucketMax = vy
              } else if (px !== bucketX) {
                ctx.lineTo(bucketX, bucketMin)
                ctx.lineTo(bucketX, bucketMax)
                ctx.lineTo(px, vy)
                bucketX = px
                bucketMin = vy
                bucketMax = vy
              } else {
                if (vy < bucketMin) bucketMin = vy
                if (vy > bucketMax) bucketMax = vy
              }
              if (hover && hover.y >= y && hover.y <= y + COUNTER_LANE_H && ts <= fromUs + (hover.x - GUTTER) / scale) {
                hoverValue = value
              }
              if (ts > toUs) break
            }
            if (started) {
              ctx.lineTo(bucketX, bucketMin)
              ctx.lineTo(bucketX, bucketMax)
            }
            ctx.stroke()
            ctx.restore()
            if (hoverValue !== null) hit = `${counter.name}: ${formatCounterValue(hoverValue)}`
          }

          if (range > 0) {
            ctx.fillStyle = '#d4d4d4'
            ctx.fillText(formatCounterValue(series.max), GUTTER + 4, y + 13)
            ctx.fillText(formatCounterValue(series.min), GUTTER + 4, y + COUNTER_LANE_H - 4)
          }

          ctx.fillStyle = 'rgb(255 255 255 / 0.06)'
          ctx.fillRect(0, y + COUNTER_LANE_H, width, 1)
          y += COUNTER_LANE_H + 4
        }
        return y
      }

      // Trailing counters strip used by AVG and ONE, where the main axis is
      // in-frame time and absolute series need their own window.
      const drawTrailingCounters = (anchorUs: number, yStart: number) => {
        ctx.fillStyle = 'rgb(255 255 255 / 0.12)'
        ctx.fillRect(0, yStart, width, 1)
        const y = yStart + 5
        ctx.fillStyle = '#d4d4d4'
        ctx.fillText('last 30s', width - 70, y + 13)
        drawCounters(Math.max(0, anchorUs - COUNTER_TRAIL_US), anchorUs, y)
      }

      const currentMode = modeRef.current

      if (currentMode === 'avg') {
        if (!snapshot) {
          ctx.fillStyle = '#d4d4d4'
          ctx.fillText('collecting first window...', GUTTER + 8, RULER_H + 20)
        } else {
          // Axis anchored to the stable budget; the volatile frame average
          // only grows the window when the shape genuinely doesn't fit, and
          // shrinking is sticky. Budget comes from the snapshot itself so a
          // frozen view is fully static.
          const budgetUs = snapshot.budgetUs
          const windowDur = stickyWindow(
            avgWindowUs,
            niceCeil(Math.max(budgetUs * 1.25, snapshot.frameAvgUs * 1.1)),
          )
          const scale = (width - GUTTER) / windowDur

          const byTid = new Map<number, typeof snapshot.shape>()
          for (const entry of snapshot.shape) {
            let list = byTid.get(entry.tid)
            if (!list) {
              list = []
              byTid.set(entry.tid, list)
            }
            list.push(entry)
          }
          const tids = [...byTid.keys()].sort((a, b) => a - b)
          const trackHeights = tids.map(tid => {
            const maxDepth = Math.max(...byTid.get(tid)!.map(e => e.depth))
            return (maxDepth + 1) * LANE_H + TRACK_PAD * 2
          })
          const shapeBottom = RULER_H + 4 + trackHeights.reduce((sum, h) => sum + h + 4, 0)

          drawRuler(0, windowDur, scale, shapeBottom, 0)

          const budgetX = Math.round(GUTTER + budgetUs * scale)
          ctx.fillStyle = 'rgb(251 191 36 / 0.6)'
          ctx.fillRect(budgetX, RULER_H, 1.5, shapeBottom - RULER_H)
          ctx.fillStyle = '#d4d4d4'
          ctx.fillText(`budget ${formatDuration(budgetUs)}`, budgetX + 4, shapeBottom - 4)

          let y = RULER_H + 4
          tids.forEach((tid, index) => {
            const trackH = trackHeights[index]
            ctx.fillStyle = '#d4d4d4'
            ctx.fillText(session.threads.get(tid)?.name ?? `tid ${tid}`, 8, y + 14)
            ctx.fillStyle = 'rgb(255 255 255 / 0.06)'
            ctx.fillRect(0, y + trackH, width, 1)

            for (const entry of byTid.get(tid)!) {
              const x = Math.round(GUTTER + entry.avgOffsetUs * scale)
              const w = Math.max(Math.round(entry.avgDurUs * scale), 1)
              const zy = y + TRACK_PAD + entry.depth * LANE_H
              ctx.globalAlpha = Math.min(1, Math.max(0.3, entry.perFrame))
              ctx.fillStyle = zoneColor(entry.nameId)
              ctx.fillRect(x, zy, w, LANE_H - 2)
              ctx.globalAlpha = 1
              if (w > 44) {
                const maxChars = Math.floor((w - 8) / 7.3)
                if (maxChars >= 3) {
                  ctx.fillStyle = '#f5f5f7'
                  ctx.fillText(
                    entry.name.length > maxChars ? entry.name.slice(0, maxChars - 1) + '…' : entry.name,
                    x + 4,
                    zy + 12,
                  )
                }
              }
              if (hover && hover.x >= x && hover.x <= x + w && hover.y >= zy && hover.y <= zy + LANE_H - 2) {
                const rate = entry.perFrame >= 0.995 ? '' : ` ×${entry.perFrame.toFixed(2)}/frame`
                hit = `${entry.name} — avg ${formatDuration(entry.avgDurUs)}${rate}`
              }
            }
            y += trackH + 4
          })

          drawTrailingCounters(frozen ? snapshot.endUs : session.maxTs, y)
        }
      } else if (currentMode === 'one') {
        // Latest fully-closed main-thread frame, or the pinned one.
        const frames = session.frames
        let live: FrameRef | null = null
        if (frames.length - frames.firstRow >= 2) {
          const row = frames.length - 2
          const startUs = frames.start.get(row)
          live = { startUs, endUs: startUs + frames.durationUs.get(row) }
        }
        latestFrame.current = live
        const frame = oneFrozen ? oneFrame.current : live

        if (!frame) {
          ctx.fillStyle = '#d4d4d4'
          ctx.fillText('waiting for a frame...', GUTTER + 8, RULER_H + 20)
        } else {
          const frameDur = frame.endUs - frame.startUs
          // Stable axis: budget-anchored, quantized, and sticky so
          // consecutive frames (or stepping across a bimodal phase change)
          // don't make the view pump; blown frames still extend it.
          const windowDur = stickyWindow(
            oneWindowUs,
            niceCeil(Math.max(session.budgetUs * 1.25, frameDur * 1.05)),
          )
          const scale = (width - GUTTER) / windowDur
          const fromUs = frame.startUs
          const toUs = frame.startUs + windowDur

          const tids = [...session.tracks.keys()].sort((a, b) => a - b)
          const tracksBottom =
            RULER_H +
            4 +
            tids.reduce((sum, tid) => sum + (session.tracks.get(tid)!.maxDepth + 1) * LANE_H + TRACK_PAD * 2 + 4, 0)

          drawRuler(fromUs, toUs, scale, tracksBottom, fromUs)

          const budgetX = Math.round(GUTTER + session.budgetUs * scale)
          ctx.fillStyle = 'rgb(251 191 36 / 0.6)'
          ctx.fillRect(budgetX, RULER_H, 1.5, tracksBottom - RULER_H)
          ctx.fillStyle = '#d4d4d4'
          ctx.fillText(`budget ${formatDuration(session.budgetUs)}`, budgetX + 4, tracksBottom - 4)

          const y = drawThreadTracks(fromUs, toUs, scale, session.maxTs)
          drawTrailingCounters(oneFrozen ? frame.endUs : session.maxTs, y)
        }
      } else {
        const v = view.current
        if (v.follow) {
          v.endUs = Math.max(session.maxTs, v.windowUs)
          v.startUs = v.endUs - v.windowUs
        }
        const scale = (width - GUTTER) / (v.endUs - v.startUs)
        drawRuler(v.startUs, v.endUs, scale, height, 0)
        const y = drawThreadTracks(v.startUs, v.endUs, scale, session.maxTs)
        drawCounters(v.startUs, v.endUs, y)
      }

      // Gutter separator.
      ctx.fillStyle = 'rgb(255 255 255 / 0.08)'
      ctx.fillRect(GUTTER - 1, 0, 1, height)

      // Tooltip state updates only on content change to keep React out of the
      // render loop.
      const text = hit ?? ''
      if (text !== lastTooltipText.current) {
        lastTooltipText.current = text
        setTooltip(hit && hover ? { x: hover.x, y: hover.y, text: hit } : null)
      } else if (hit && hover && tooltip && (tooltip.x !== hover.x || tooltip.y !== hover.y)) {
        setTooltip({ x: hover.x, y: hover.y, text: hit })
      }
    })

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const onWheel = (event: WheelEvent) => {
        if (modeRef.current !== 'raw') return
        event.preventDefault()
        const v = view.current
        const rect = canvas.getBoundingClientRect()
        const x = event.clientX - rect.left
        const factor = Math.exp(event.deltaY * 0.0015)
        const span = v.endUs - v.startUs
        const newSpan = Math.min(MAX_SPAN_US, Math.max(MIN_SPAN_US, span * factor))
        if (v.follow) {
          v.windowUs = newSpan
        } else {
          const anchor = v.startUs + (x - GUTTER) / ((rect.width - GUTTER) / span)
          const ratio = newSpan / span
          v.startUs = anchor - (anchor - v.startUs) * ratio
          v.endUs = v.startUs + newSpan
        }
      }
      canvas.addEventListener('wheel', onWheel, { passive: false })
      return () => canvas.removeEventListener('wheel', onWheel)
    }, [canvasRef])

    const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0 || mode !== 'raw') return
      drag.current = { lastX: event.clientX }
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      mouse.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      if (!drag.current) return
      const v = view.current
      const scale = (rect.width - GUTTER) / (v.endUs - v.startUs)
      const dxUs = (event.clientX - drag.current.lastX) / scale
      drag.current.lastX = event.clientX
      v.startUs -= dxUs
      v.endUs -= dxUs
      if (v.follow) {
        v.follow = false
        setFollowing(false)
      }
    }
    const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
      drag.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    const modeButton = (target: Mode, key: string, label: string) => (
      <button
        onClick={() => setMode(target)}
        className={`px-2.5 py-1 ${
          mode === target ? 'bg-panel-bright text-ember' : 'text-neutral-300 hover:text-neutral-50'
        }`}
      >
        {label}
        <span className={mode === target ? 'ml-1 text-ember/70' : 'ml-1 text-neutral-300'}>({key})</span>
      </button>
    )

    const liveIndicator =
      mode === 'avg' ? (
        frozen ? <span className="text-ember">PAUSED</span> : <span className="text-emerald-400">LIVE</span>
      ) : mode === 'one' ? (
        oneFrozen ? <span className="text-ember">PAUSED</span> : <span className="text-emerald-400">LIVE</span>
      ) : following ? (
        <span className="text-emerald-400">FOLLOW</span>
      ) : (
        <span className="text-ember">PAUSED</span>
      )

    const hints =
      mode === 'avg' ? (
        <>
          <Kbd>space</Kbd> pause <Kbd>←</Kbd>
          <Kbd>→</Kbd> snapshots
        </>
      ) : mode === 'one' ? (
        <>
          <Kbd>space</Kbd> pause <Kbd>←</Kbd>
          <Kbd>→</Kbd> frames
        </>
      ) : (
        <>
          <Kbd>space</Kbd> follow <Kbd>←</Kbd>
          <Kbd>→</Kbd> pan <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> zoom
        </>
      )

    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[3px] border border-hairline bg-panel">
        <div className="flex h-9 shrink-0 items-center gap-3 border-b border-hairline px-3 text-sm">
          <span className="flex items-center gap-1.5 text-neutral-300">{hints}</span>
          <span className="flex-1" />
          <span className="text-neutral-300">{liveIndicator}</span>
          <span className="flex overflow-hidden rounded-[3px] border border-hairline">
            {modeButton('avg', '1', 'AVG')}
            {modeButton('one', '2', 'ONE')}
            {modeButton('raw', '3', 'RAW')}
          </span>
        </div>
        <div className="relative min-h-0 flex-1">
          <canvas
            ref={canvasRef}
            className={`size-full ${mode === 'raw' ? 'cursor-crosshair' : 'cursor-default'}`}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerLeave={() => (mouse.current = null)}
          />
          {tooltip && (
            <div
              className="pointer-events-none absolute z-10 rounded-[3px] border border-hairline bg-panel-bright px-2 py-1 text-sm whitespace-nowrap text-neutral-50"
              style={{ left: tooltip.x + 14, top: tooltip.y + 12 }}
            >
              {tooltip.text}
            </div>
          )}
        </div>
      </div>
    )
  },
  (prev, next) =>
    prev.session.id === next.session.id &&
    prev.snapshot === next.snapshot &&
    prev.frozen === next.frozen,
)
