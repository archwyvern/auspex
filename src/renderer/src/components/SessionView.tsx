import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session, Snapshot } from '../lib/store'
import { formatInt, formatSessionSeconds, formatUptime } from '../lib/fmt'
import { FrameBar } from './FrameBar'
import { Timeline, type TimelineController } from './Timeline'
import { SnapshotPanel } from './SnapshotPanel'

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-display text-sm font-semibold tracking-widest text-neutral-300 uppercase">
      {children}
    </div>
  )
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-[3px] border border-hairline bg-panel px-3 py-2">
      <Label>{label}</Label>
      <div className={`mt-0.5 text-xl tabular-nums ${accent ? 'text-ember' : 'text-neutral-50'}`}>{value}</div>
    </div>
  )
}

function Panel({
  title,
  className = '',
  children,
}: {
  title: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`flex min-h-0 flex-col rounded-[3px] border border-hairline bg-panel ${className}`}>
      <div className="border-b border-hairline px-3 py-1.5">
        <Label>{title}</Label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

export function SessionView({ session }: { session: Session }) {
  const timelineController = useRef<TimelineController | null>(null)
  // Frozen AVG window: held here so the waterfall and the zones table
  // freeze on the same snapshot together.
  const [frozenAvg, setFrozenAvg] = useState<Snapshot | null>(null)

  useEffect(() => setFrozenAvg(null), [session.id])

  const toggleFreeze = useCallback(() => {
    setFrozenAvg(prev => (prev ? null : (session.snapshots[session.snapshots.length - 1] ?? null)))
  }, [session])

  // Arrow stepping through snapshot history; stepping to/past the newest
  // returns to live.
  const stepSnapshot = useCallback(
    (delta: number) => {
      setFrozenAvg(prev => {
        const snapshots = session.snapshots
        if (snapshots.length === 0) return null
        const currentIndex = prev ? snapshots.findIndex(s => s.seq === prev.seq) : snapshots.length - 1
        const next = (currentIndex < 0 ? snapshots.length - 1 : currentIndex) + delta
        if (next >= snapshots.length - 1) return null
        return snapshots[Math.max(0, next)]
      })
    },
    [session],
  )

  const statusLabel =
    session.status === 'live' ? 'LIVE' : session.status === 'closed' ? 'DISCONNECTED' : 'HANDSHAKE'
  const statusColor =
    session.status === 'live'
      ? 'text-emerald-400 border-emerald-400/40'
      : session.status === 'closed'
        ? 'text-red-400 border-red-400/40'
        : 'text-ember border-ember/40'

  const markers = [...session.markers].slice(-50).reverse()
  const latestSnapshot = session.snapshots[session.snapshots.length - 1] ?? null
  const shownSnapshot = frozenAvg ?? latestSnapshot

  return (
    <div className="flex h-full gap-2 p-2">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-baseline gap-4 px-1">
          <h1 className="font-display text-xl font-semibold text-neutral-50">
            {session.name ?? `session ${session.id}`}
          </h1>
          <span className="text-sm text-neutral-300">
            pid <span className="text-neutral-50 tabular-nums">{session.pid ?? '?'}</span>
          </span>
          <span className="text-sm text-neutral-300">
            up <span className="text-neutral-50 tabular-nums">{formatUptime(session.startMs)}</span>
          </span>
          <span className={`rounded-[3px] border px-2 py-0.5 text-sm tracking-widest ${statusColor}`}>
            {statusLabel}
          </span>
          {session.parseErrors > 0 && (
            <span className="text-sm text-red-400">{session.parseErrors} parse errors</span>
          )}
          <span className="flex-1" />
          <span className="text-sm text-neutral-300">
            budget{' '}
            <span className="text-neutral-50 tabular-nums">
              {(session.budgetUs / 1000).toFixed(1)}ms
            </span>
          </span>
        </div>

        <FrameBar
          key={`fb-${session.id}`}
          session={session}
          onSelectFrame={(startUs, endUs) => timelineController.current?.pinFrame(startUs, endUs)}
        />

        <Timeline
          key={`tl-${session.id}`}
          session={session}
          controllerRef={timelineController}
          snapshot={shownSnapshot}
          frozen={frozenAvg !== null}
          onToggleFreeze={toggleFreeze}
          onStepSnapshot={stepSnapshot}
        />
      </div>

      <aside className="flex w-[30rem] shrink-0 flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="fps" value={session.fps.toFixed(1)} accent />
          <StatTile label="frames" value={formatInt(session.framesTotal)} />
          <StatTile label="events /s" value={formatInt(session.eventsRate)} />
          <StatTile label="zones" value={formatInt(session.zones)} />
        </div>

        <SnapshotPanel snapshot={shownSnapshot} frozen={frozenAvg !== null} />

        <Panel title="markers" className="h-56 shrink-0">
          {markers.length === 0 ? (
            <div className="px-3 py-1.5 text-sm text-neutral-300">none yet</div>
          ) : (
            <table className="w-full text-left text-sm">
              <tbody>
                {markers.map((marker, index) => (
                  <tr key={index} className="border-b border-hairline last:border-b-0">
                    <td className="px-3 py-1 text-neutral-300 tabular-nums">
                      {formatSessionSeconds(marker.tsUs, session.tsFreq)}
                    </td>
                    <td className="px-3 py-1 text-ember">{marker.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </aside>
    </div>
  )
}
