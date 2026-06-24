import type { Snapshot } from '../lib/store'
import { formatDuration } from '../lib/canvas'

type SnapshotPanelProps = {
  snapshot: Snapshot | null
  frozen?: boolean
  selectedZone?: number | null
  onSelectZone?: (nameId: number | null) => void
}

// Per-zone stats for the latest aggregation window. Sorted by total
// self-time: the honest "where the time actually went" ordering — parents
// don't absorb credit for their children.
export function SnapshotPanel({
  snapshot,
  frozen = false,
  selectedZone = null,
  onSelectZone,
}: SnapshotPanelProps) {
  const windowUs = snapshot ? snapshot.endUs - snapshot.startUs : 0

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-[3px] border border-border bg-surface">
      <div className="flex items-baseline gap-3 border-b border-border px-3 py-1.5">
        <div className="font-sans text-sm font-semibold tracking-widest text-fg-mid uppercase">
          zones
        </div>
        {snapshot && (
          <>
            <span className="text-sm text-fg-mid">
              last {snapshot.frames} frames @ {(snapshot.startUs / 1_000_000).toFixed(1)}s
            </span>
            {frozen && <span className="text-sm text-accent">PAUSED</span>}
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!snapshot ? (
          <div className="px-3 py-2 text-sm text-fg-mid">collecting...</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-fg-mid">
                <th className="px-3 py-1 font-normal tracking-widest uppercase">zone</th>
                <th className="px-2 py-1 text-right font-normal tracking-widest uppercase">count</th>
                <th className="px-2 py-1 text-right font-normal tracking-widest uppercase">avg</th>
                <th className="px-2 py-1 text-right font-normal tracking-widest uppercase">self Σ</th>
                <th className="px-2 py-1 text-right font-normal tracking-widest uppercase">max</th>
                <th className="px-3 py-1 text-right font-normal tracking-widest uppercase">% win</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.zones.map(zone => (
                <tr
                  key={zone.nameId}
                  onClick={() => onSelectZone?.(zone.nameId === selectedZone ? null : zone.nameId)}
                  className={`cursor-pointer border-t border-border ${
                    zone.nameId === selectedZone ? 'bg-surface-raised' : 'hover:bg-white/5'
                  }`}
                >
                  <td className={`px-3 py-1 ${zone.nameId === selectedZone ? 'text-accent' : 'text-fg'}`}>
                    {zone.name}
                  </td>
                  <td className="px-2 py-1 text-right text-fg-mid tabular-nums">{zone.count}</td>
                  <td className="px-2 py-1 text-right text-fg tabular-nums">
                    {formatDuration(zone.totalUs / zone.count)}
                  </td>
                  <td className="px-2 py-1 text-right text-fg tabular-nums">
                    {formatDuration(zone.selfUs)}
                  </td>
                  <td className="px-2 py-1 text-right text-fg tabular-nums">
                    {formatDuration(zone.maxUs)}
                  </td>
                  <td className="px-3 py-1 text-right text-accent tabular-nums">
                    {((zone.selfUs / windowUs) * 100).toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
