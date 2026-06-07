import type { Session } from '../lib/store'
import { formatInt, formatSessionSeconds, formatUptime } from '../lib/fmt'

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-sm tracking-widest text-neutral-300 uppercase">{children}</div>
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-[3px] border border-hairline bg-panel p-3">
      <Label>{label}</Label>
      <div className={`mt-1 text-2xl tabular-nums ${accent ? 'text-ember' : 'text-neutral-50'}`}>{value}</div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-col rounded-[3px] border border-hairline bg-panel">
      <div className="border-b border-hairline px-3 py-2">
        <Label>{title}</Label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

export function SessionView({ session }: { session: Session }) {
  const statusLabel =
    session.status === 'live' ? 'LIVE' : session.status === 'closed' ? 'DISCONNECTED' : 'HANDSHAKE'
  const statusColor =
    session.status === 'live'
      ? 'text-emerald-400 border-emerald-400/40'
      : session.status === 'closed'
        ? 'text-red-400 border-red-400/40'
        : 'text-ember border-ember/40'

  const threads = [...session.threads.values()].sort((a, b) => a.tid - b.tid)
  const counters = [...session.counters.entries()].sort(([a], [b]) => a.localeCompare(b))
  const markers = [...session.markers].reverse()

  return (
    <div className="flex h-full flex-col gap-3 p-3">
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
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatTile label="fps" value={session.fps.toFixed(1)} accent />
        <StatTile label="frames" value={formatInt(session.frames)} />
        <StatTile label="events /s" value={formatInt(session.eventsRate)} />
        <StatTile label="zones" value={formatInt(session.zones)} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-3 gap-3">
        <Panel title="threads">
          <table className="w-full text-left text-sm">
            <tbody>
              {threads.map(thread => (
                <tr key={thread.tid} className="border-b border-hairline last:border-b-0">
                  <td className="px-3 py-1.5 text-neutral-300 tabular-nums">{thread.tid}</td>
                  <td className="px-3 py-1.5 text-neutral-50">{thread.name}</td>
                  <td className="px-3 py-1.5 text-right text-neutral-300 tabular-nums">
                    {formatInt(thread.events)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="counters">
          <table className="w-full text-left text-sm">
            <tbody>
              {counters.map(([name, value]) => (
                <tr key={name} className="border-b border-hairline last:border-b-0">
                  <td className="px-3 py-1.5 text-neutral-50">{name}</td>
                  <td className="px-3 py-1.5 text-right text-ember tabular-nums">{formatInt(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="markers">
          {markers.length === 0 ? (
            <div className="px-3 py-2 text-sm text-neutral-300">none yet</div>
          ) : (
            <table className="w-full text-left text-sm">
              <tbody>
                {markers.map((marker, index) => (
                  <tr key={index} className="border-b border-hairline last:border-b-0">
                    <td className="px-3 py-1.5 text-neutral-300 tabular-nums">
                      {formatSessionSeconds(marker.tsUs, session.tsFreq)}
                    </td>
                    <td className="px-3 py-1.5 text-ember">{marker.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  )
}
