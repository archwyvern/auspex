import { DismissRegular } from '@fluentui/react-icons'
import type { Session } from '../lib/store'

function StatusDot({ status }: { status: Session['status'] }) {
  if (status === 'live') return <span className="pulse-dot size-2 shrink-0 rounded-full bg-emerald-400" />
  if (status === 'handshaking') return <span className="size-2 shrink-0 rounded-full bg-ember" />
  return <span className="size-2 shrink-0 rounded-full bg-neutral-600" />
}

type TabStripProps = {
  sessions: Session[]
  activeId: number | null
  onSelect: (id: number) => void
  onClose: (id: number) => void
}

export function TabStrip({ sessions, activeId, onSelect, onClose }: TabStripProps) {
  return (
    <div className="flex flex-1 items-stretch overflow-x-auto">
      {sessions.map(session => {
        const active = session.id === activeId
        const dead = session.status === 'closed'
        return (
          <button
            key={session.id}
            onClick={() => onSelect(session.id)}
            className={`group relative flex items-center gap-2 border-r border-hairline px-3 text-sm whitespace-nowrap transition-colors ${
              active ? 'bg-panel text-neutral-50' : 'text-neutral-300 hover:bg-white/5'
            }`}
          >
            {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-ember" />}
            <StatusDot status={session.status} />
            <span className={dead && !active ? 'text-neutral-300' : undefined}>
              {session.name ?? `session ${session.id}`}
            </span>
            {session.pid !== null && <span className="text-sm text-neutral-300">{session.pid}</span>}
            {session.status === 'live' && (
              <span className="text-sm text-ember tabular-nums">{session.fps.toFixed(0)}fps</span>
            )}
            {dead && (
              <span
                role="button"
                tabIndex={0}
                onClick={event => {
                  event.stopPropagation()
                  onClose(session.id)
                }}
                className="-mr-1 rounded-sm p-0.5 text-neutral-300 hover:bg-white/10 hover:text-neutral-100"
              >
                <DismissRegular className="text-[13px]" />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
