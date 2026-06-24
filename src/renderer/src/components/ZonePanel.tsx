import { memo } from 'react'
import type { Session } from '../lib/store'
import { formatDuration, useCanvasLoop } from '../lib/canvas'

type ZonePanelProps = {
  session: Session
  nameId: number
  onClose: () => void
}

// Focused card for one selected zone name: current-window stats plus a
// sparkline of per-frame self-time across the snapshot history — "what has
// this zone been doing over time".
export const ZonePanel = memo(
  function ZonePanel({ session, nameId, onClose }: ZonePanelProps) {
    const name = session.strings.get(nameId) ?? `#${nameId}`
    const latest = session.snapshots[session.snapshots.length - 1]
    const stat = latest?.zones.find(zone => zone.nameId === nameId)

    const canvasRef = useCanvasLoop((ctx, width, height) => {
      ctx.clearRect(0, 0, width, height)
      const snapshots = session.snapshots
      if (snapshots.length < 2) return
      // Per-frame self-time per snapshot window.
      let max = 0
      const points: number[] = []
      for (const snapshot of snapshots) {
        const zone = snapshot.zones.find(z => z.nameId === nameId)
        const value = zone ? zone.selfUs / snapshot.frames : 0
        points.push(value)
        if (value > max) max = value
      }
      if (max <= 0) return
      ctx.strokeStyle = '#fbbf24'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      const step = width / Math.max(points.length - 1, 1)
      points.forEach((value, index) => {
        const x = index * step
        const y = height - 3 - (value / max) * (height - 8)
        if (index === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
      ctx.fillStyle = '#d4d4d4'
      ctx.font = '12px "IBM Plex Mono", monospace'
      ctx.fillText(`max ${formatDuration(max)}/frame`, 4, 13)
    })

    return (
      <div className="flex h-44 shrink-0 flex-col rounded-[3px] border border-accent/40 bg-surface">
        <div className="flex items-baseline gap-3 border-b border-border px-3 py-1.5">
          <div className="font-sans text-sm font-semibold tracking-widest text-accent uppercase">
            zone
          </div>
          <span className="text-sm text-fg">{name}</span>
          <span className="flex-1" />
          <button
            onClick={onClose}
            className="rounded-[3px] border border-border px-1.5 text-sm text-fg-mid hover:bg-white/5 hover:text-fg"
          >
            esc
          </button>
        </div>
        <div className="flex gap-4 px-3 py-1.5 text-sm">
          {stat ? (
            <>
              <span className="text-fg-mid">
                ×<span className="text-fg tabular-nums">{(stat.count / (latest?.frames ?? 1)).toFixed(2)}</span>/frame
              </span>
              <span className="text-fg-mid">
                avg <span className="text-fg tabular-nums">{formatDuration(stat.totalUs / stat.count)}</span>
              </span>
              <span className="text-fg-mid">
                self <span className="text-fg tabular-nums">{formatDuration(stat.selfUs / (latest?.frames ?? 1))}</span>/frame
              </span>
              <span className="text-fg-mid">
                max <span className="text-fg tabular-nums">{formatDuration(stat.maxUs)}</span>
              </span>
            </>
          ) : (
            <span className="text-fg-mid">not present in current window</span>
          )}
        </div>
        <div className="relative min-h-0 flex-1 px-1 pb-1">
          <canvas ref={canvasRef} className="size-full" />
        </div>
      </div>
    )
  },
  (prev, next) => prev.session.id === next.session.id && prev.nameId === next.nameId,
)
