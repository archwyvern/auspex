import { useRef, useState } from 'react'
import type { Session, Snapshot } from '../lib/store'
import { formatInt, formatSessionSeconds, formatUptime } from '../lib/fmt'
import { FrameBar } from './FrameBar'
import { Timeline, type TimelineController } from './Timeline'
import { SnapshotList } from './SnapshotList'
import { SnapshotPanel } from './SnapshotPanel'

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-sm tracking-widest text-neutral-300 uppercase">{children}</div>
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-[3px] border border-hairline bg-panel px-3 py-2">
      <Label>{label}</Label>
      <div className={`mt-0.5 text-xl tabular-nums ${accent ? 'text-ember' : 'text-neutral-50'}`}>{value}</div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-col rounded-[3px] border border-hairline bg-panel">
      <div className="border-b border-hairline px-3 py-1.5">
        <Label>{title}</Label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

export function SessionView({ session }: { session: Session }) {
  const timelineController = useRef<TimelineController | null>(null)
  const [pinnedSeq, setPinnedSeq] = useState<number | null>(null)

  const statusLabel =
    session.status === 'live' ? 'LIVE' : session.status === 'closed' ? 'DISCONNECTED' : 'HANDSHAKE'
  const statusColor =
    session.status === 'live'
      ? 'text-emerald-400 border-emerald-400/40'
      : session.status === 'closed'
        ? 'text-red-400 border-red-400/40'
        : 'text-ember border-ember/40'

  const counters = [...session.counters.entries()].sort(([a], [b]) => a.localeCompare(b))
  const markers = [...session.markers].slice(-50).reverse()

  const pinned = pinnedSeq !== null ? (session.snapshots.find(s => s.seq === pinnedSeq) ?? null) : null
  const shownSnapshot = pinned ?? session.snapshots[session.snapshots.length - 1] ?? null

  const selectSnapshot = (snapshot: Snapshot | null) => {
    setPinnedSeq(snapshot?.seq ?? null)
    if (snapshot) timelineController.current?.zoomTo(snapshot.startUs, snapshot.endUs)
  }

  return (
    <div className="flex h-full gap-2 p-2">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-baseline gap-4 px-1">
          <h1 className="text-xl text-neutral-50">{session.name ?? `session ${session.id}`}</h1>
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

        <div className="grid grid-cols-4 gap-2">
          <StatTile label="fps" value={session.fps.toFixed(1)} accent />
          <StatTile label="frames" value={formatInt(session.framesTotal)} />
          <StatTile label="events /s" value={formatInt(session.eventsRate)} />
          <StatTile label="zones" value={formatInt(session.zones)} />
        </div>

        <FrameBar
          key={`fb-${session.id}`}
          session={session}
          onSelectFrame={(startUs, endUs) => timelineController.current?.zoomTo(startUs, endUs)}
        />

        <Timeline key={`tl-${session.id}`} session={session} controllerRef={timelineController} />

        <div className="grid h-44 shrink-0 grid-cols-[3fr_1fr_1fr] gap-2">
          <SnapshotPanel snapshot={shownSnapshot} pinned={pinned !== null} />

          <Panel title="counters">
            <table className="w-full text-left text-sm">
              <tbody>
                {counters.map(([name, value]) => (
                  <tr key={name} className="border-b border-hairline last:border-b-0">
                    <td className="px-3 py-1 text-neutral-50">{name}</td>
                    <td className="px-3 py-1 text-right text-ember tabular-nums">{formatInt(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="markers">
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
        </div>
      </div>

      <SnapshotList session={session} selectedSeq={pinnedSeq} onSelect={selectSnapshot} />
    </div>
  )
}
