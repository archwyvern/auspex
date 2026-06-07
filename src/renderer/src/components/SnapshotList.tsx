import type { Session, Snapshot } from '../lib/store'

function healthColor(snapshot: Snapshot, budgetUs: number): string {
  const ratio = snapshot.frameMaxUs / budgetUs
  if (ratio > 2) return 'bg-red-400'
  if (ratio > 1.35) return 'bg-ember'
  return 'bg-emerald-400'
}

type SnapshotListProps = {
  session: Session
  selectedSeq: number | null
  onSelect: (snapshot: Snapshot | null) => void
}

// The augur's ledger: one row per closed aggregation window, newest first.
// No selection = follow the latest snapshot live; clicking a row pins it and
// zooms the timeline to its window.
export function SnapshotList({ session, selectedSeq, onSelect }: SnapshotListProps) {
  const snapshots = session.snapshots

  return (
    <aside className="flex w-64 shrink-0 flex-col rounded-[3px] border border-hairline bg-panel">
      <div className="flex items-center border-b border-hairline px-3 py-1.5">
        <div className="text-sm tracking-widest text-neutral-300 uppercase">snapshots</div>
        <span className="flex-1" />
        {selectedSeq !== null ? (
          <button
            onClick={() => onSelect(null)}
            className="rounded-[3px] border border-ember/40 px-1.5 text-sm text-ember hover:bg-ember/10"
          >
            LIVE
          </button>
        ) : (
          <span className="text-sm text-emerald-400">LIVE</span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {snapshots.length === 0 ? (
          <div className="px-3 py-2 text-sm text-neutral-300">collecting...</div>
        ) : (
          [...snapshots].reverse().map(snapshot => {
            const selected = snapshot.seq === selectedSeq
            return (
              <button
                key={snapshot.seq}
                onClick={() => onSelect(selected ? null : snapshot)}
                className={`flex w-full items-center gap-2 border-b border-hairline px-2 py-1 text-left text-sm tabular-nums ${
                  selected ? 'bg-panel-bright text-neutral-50' : 'text-neutral-300 hover:bg-white/5'
                }`}
              >
                <span className={`size-2 shrink-0 rounded-full ${healthColor(snapshot, session.budgetUs)}`} />
                <span className="w-12 text-neutral-50">{(snapshot.startUs / 1_000_000).toFixed(1)}s</span>
                <span className="w-14">{snapshot.fps.toFixed(0)} fps</span>
                <span className="flex-1 text-right">
                  {(snapshot.frameAvgUs / 1000).toFixed(1)}
                  <span className="text-neutral-300">/</span>
                  {(snapshot.frameMaxUs / 1000).toFixed(1)}ms
                </span>
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}
