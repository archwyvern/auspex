import { Kbd } from './Kbd'

type StatusBarProps = {
  state: AuspexServerState
  sessionCount: number
  demoRunning: boolean
}

export function StatusBar({ state, sessionCount, demoRunning }: StatusBarProps) {
  return (
    <div className="flex h-8 items-center gap-3 border-t border-hairline bg-panel px-3 text-sm">
      <span
        className={`size-2 rounded-full ${
          state.listening ? 'bg-emerald-400' : state.error ? 'bg-red-400' : 'bg-neutral-600'
        }`}
      />
      {state.listening ? (
        <span className="text-neutral-300">
          listening{' '}
          <span className="text-neutral-50 tabular-nums">
            {state.host}:{state.port}
          </span>
        </span>
      ) : state.error ? (
        <span className="text-red-400">listen failed: {state.error}</span>
      ) : (
        <span className="text-neutral-300">starting...</span>
      )}
      <span className="flex items-center gap-1.5 text-neutral-300">
        <Kbd>ctrl</Kbd>
        <Kbd>←</Kbd>
        <Kbd>→</Kbd> tabs
      </span>
      <span className="flex-1" />
      <button
        onClick={() => (demoRunning ? window.auspex.stopDemo() : window.auspex.runDemo())}
        className={`rounded-[3px] border px-2.5 py-0.5 transition-colors ${
          demoRunning
            ? 'border-ember/40 text-ember hover:bg-ember/10'
            : 'border-hairline text-neutral-300 hover:bg-white/5 hover:text-neutral-50'
        }`}
      >
        {demoRunning ? 'stop demo' : 'run demo'}
      </button>
      <span className="text-neutral-300">
        <span className="text-neutral-50 tabular-nums">{sessionCount}</span> session
        {sessionCount === 1 ? '' : 's'}
      </span>
      <span className="text-neutral-300">electron {window.auspex.versions.electron}</span>
    </div>
  )
}
