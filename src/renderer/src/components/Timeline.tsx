import { memo, useEffect, useRef, useState } from 'react'
import type { Session } from '../lib/store'
import { OPEN_END } from '../lib/columns'
import { formatDuration, formatTick, tickStep, useCanvasLoop, zoneColor } from '../lib/canvas'

const GUTTER = 110
const RULER_H = 22
const LANE_H = 16
const TRACK_PAD = 5
const MIN_SPAN_US = 200
const MAX_SPAN_US = 120_000_000
const DEFAULT_WINDOW_US = 250_000

export type TimelineController = {
  zoomTo: (startUs: number, endUs: number) => void
}

type TimelineProps = {
  session: Session
  controllerRef: React.MutableRefObject<TimelineController | null>
}

type ViewState = {
  startUs: number
  endUs: number
  follow: boolean
  windowUs: number
}

// The waterfall: per-thread tracks, zones as depth-stacked rects, time ruler,
// marker ticks. Follow mode pins the right edge to the newest data; space
// toggles, wheel zooms around the cursor, drag pans.
export const Timeline = memo(
  function Timeline({ session, controllerRef }: TimelineProps) {
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

    controllerRef.current = {
      zoomTo: (startUs, endUs) => {
        const pad = (endUs - startUs) * 0.15
        view.current.startUs = startUs - pad
        view.current.endUs = endUs + pad
        view.current.follow = false
        setFollowing(false)
      },
    }

    useEffect(() => {
      const onKey = (event: KeyboardEvent) => {
        if (event.code !== 'Space') return
        const target = event.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
        event.preventDefault()
        const v = view.current
        v.follow = !v.follow
        if (v.follow) v.windowUs = Math.max(MIN_SPAN_US, v.endUs - v.startUs)
        setFollowing(v.follow)
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }, [])

    const canvasRef = useCanvasLoop((ctx, width, height) => {
      const v = view.current
      if (v.follow) {
        v.endUs = Math.max(session.maxTs, v.windowUs)
        v.startUs = v.endUs - v.windowUs
      }
      const spanUs = v.endUs - v.startUs
      const scale = (width - GUTTER) / spanUs
      const nowUs = session.maxTs

      ctx.clearRect(0, 0, width, height)
      ctx.font = '12px "JetBrains Mono", "Cascadia Mono", monospace'

      // Ruler.
      const step = tickStep(1 / scale, 90)
      ctx.fillStyle = 'rgb(255 255 255 / 0.06)'
      ctx.fillRect(GUTTER, 0, width - GUTTER, RULER_H)
      let tick = Math.ceil(v.startUs / step) * step
      while (tick <= v.endUs) {
        const x = GUTTER + (tick - v.startUs) * scale
        ctx.fillStyle = 'rgb(255 255 255 / 0.12)'
        ctx.fillRect(x, 0, 1, height)
        ctx.fillStyle = '#d4d4d4'
        ctx.fillText(formatTick(tick, step), x + 4, 15)
        tick += step
      }

      // Tracks.
      const hover = mouse.current
      let hit: string | null = null
      let y = RULER_H + 4
      const tids = [...session.tracks.keys()].sort((a, b) => a - b)
      for (const tid of tids) {
        const track = session.tracks.get(tid)!
        const lanes = track.maxDepth + 1
        const trackH = lanes * LANE_H + TRACK_PAD * 2

        // Gutter label + separator.
        ctx.fillStyle = '#d4d4d4'
        ctx.fillText(session.threads.get(tid)?.name ?? `tid ${tid}`, 8, y + 14)
        ctx.fillStyle = 'rgb(255 255 255 / 0.06)'
        ctx.fillRect(0, y + trackH, width, 1)

        // Zones, viewport-culled; sub-pixel zones coalesce per lane.
        const lastX: number[] = new Array(lanes).fill(-Infinity)
        for (let row = track.firstVisible(v.startUs); row < track.length; row++) {
          const start = track.start.get(row)
          if (start > v.endUs) break
          let end = track.end.get(row)
          const open = end === OPEN_END
          if (open) end = nowUs
          if (end < v.startUs) continue
          const depth = track.depth.get(row)
          const x = GUTTER + (start - v.startUs) * scale
          const w = Math.max((end - start) * scale, 0.75)
          if (w < 0.5 && x - lastX[depth] < 0.5) continue
          lastX[depth] = x
          const zy = y + TRACK_PAD + depth * LANE_H
          ctx.fillStyle = zoneColor(track.name.get(row))
          ctx.fillRect(x, zy, w, LANE_H - 2)
          if (open) {
            ctx.fillStyle = '#fbbf24'
            ctx.fillRect(x + w - 1.5, zy, 1.5, LANE_H - 2)
          }
          if (w > 44) {
            const label = session.strings.get(track.name.get(row)) ?? ''
            const maxChars = Math.floor((w - 8) / 7.3)
            if (maxChars >= 3) {
              ctx.fillStyle = '#f5f5f7'
              ctx.fillText(
                label.length > maxChars ? label.slice(0, maxChars - 1) + '…' : label,
                x + 4,
                zy + 12,
              )
            }
          }
          if (
            hover &&
            hover.x >= x &&
            hover.x <= x + w &&
            hover.y >= zy &&
            hover.y <= zy + LANE_H - 2
          ) {
            const name = session.strings.get(track.name.get(row)) ?? '?'
            hit = `${name} — ${open ? `${formatDuration(end - start)} (open)` : formatDuration(end - start)}`
          }
        }

        // Marker ticks for this thread.
        ctx.fillStyle = 'rgb(251 191 36 / 0.85)'
        for (const marker of session.markers) {
          if (marker.tid !== tid || marker.tsUs < v.startUs || marker.tsUs > v.endUs) continue
          const x = GUTTER + (marker.tsUs - v.startUs) * scale
          ctx.fillRect(x, y + 1, 1, trackH - 2)
        }

        y += trackH + 4
      }

      // Gutter base layer separator.
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
      if (event.button !== 0) return
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

    return (
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[3px] border border-hairline bg-panel">
        <canvas
          ref={canvasRef}
          className="size-full cursor-crosshair"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerLeave={() => (mouse.current = null)}
        />
        <div className="absolute top-7 right-2 text-sm text-neutral-300">
          {following ? (
            <span className="text-emerald-400">FOLLOW</span>
          ) : (
            <span className="text-ember">PAUSED</span>
          )}{' '}
          · space
        </div>
        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 rounded-[3px] border border-hairline bg-panel-bright px-2 py-1 text-sm whitespace-nowrap text-neutral-50"
            style={{ left: tooltip.x + 14, top: tooltip.y + 12 }}
          >
            {tooltip.text}
          </div>
        )}
      </div>
    )
  },
  (prev, next) => prev.session.id === next.session.id,
)
