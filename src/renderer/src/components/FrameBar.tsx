import { memo, useRef } from 'react'
import type { Session } from '../lib/store'
import { OPEN_END } from '../lib/columns'
import { useCanvasLoop } from '../lib/canvas'

const BAR_GAP = 1
const MIN_BAR_W = 2
const HEADROOM = 2.5 // bar at full height = 2.5x budget

type FrameBarProps = {
  session: Session
  onSelectFrame: (startUs: number, endUs: number) => void
}

// The seismogram: one bar per recent frame, height relative to the session's
// own median frame time, colored by how badly the budget is blown. Clicking
// a bar zooms the timeline to that frame.
export const FrameBar = memo(
  function FrameBar({ session, onSelectFrame }: FrameBarProps) {
    // Geometry of the latest draw, for click hit-testing.
    const layout = useRef({ firstRow: 0, barW: MIN_BAR_W + BAR_GAP, count: 0 })

    const canvasRef = useCanvasLoop((ctx, width, height) => {
      ctx.clearRect(0, 0, width, height)
      const frames = session.frames
      const budget = session.budgetUs
      const visible = Math.floor(width / (MIN_BAR_W + BAR_GAP))
      const count = Math.min(visible, frames.length - frames.firstRow)
      if (count <= 0 || budget <= 0) return
      const firstRow = frames.length - count
      const barW = Math.max(MIN_BAR_W, Math.floor(width / count) - BAR_GAP)
      layout.current = { firstRow, barW, count }

      // Budget line.
      const budgetY = height - (height * 1) / HEADROOM
      ctx.fillStyle = 'rgb(255 255 255 / 0.15)'
      ctx.fillRect(0, budgetY, width, 1)

      for (let i = 0; i < count; i++) {
        const row = firstRow + i
        let duration = frames.durationUs.get(row)
        if (duration === OPEN_END) duration = Math.max(0, session.maxTs - frames.start.get(row))
        const ratio = duration / budget
        const h = Math.max(1, Math.min(height, (height * ratio) / HEADROOM))
        ctx.fillStyle =
          ratio > 2 ? '#f87171' : ratio > 1.35 ? '#fbbf24' : '#34d399'
        ctx.globalAlpha = ratio > 1.35 ? 1 : 0.75
        ctx.fillRect(i * (barW + BAR_GAP), height - h, barW, h)
      }
      ctx.globalAlpha = 1
    })

    const click = (event: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const { firstRow, barW, count } = layout.current
      const index = Math.floor((event.clientX - rect.left) / (barW + BAR_GAP))
      if (index < 0 || index >= count) return
      const row = firstRow + index
      const frames = session.frames
      const startUs = frames.start.get(row)
      let duration = frames.durationUs.get(row)
      if (duration === OPEN_END) duration = Math.max(1000, session.maxTs - startUs)
      onSelectFrame(startUs, startUs + duration)
    }

    return (
      <div className="h-14 shrink-0 rounded-[3px] border border-border bg-surface p-1">
        <canvas ref={canvasRef} className="size-full cursor-crosshair" onClick={click} />
      </div>
    )
  },
  (prev, next) => prev.session.id === next.session.id,
)
