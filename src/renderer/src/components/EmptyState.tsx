import { PulseRegular } from '@fluentui/react-icons'

export function EmptyState({ state, demoRunning }: { state: AuspexServerState; demoRunning: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <PulseRegular className="text-7xl text-ember" />
      <div className="font-display text-2xl font-semibold tracking-[0.3em] text-neutral-50">AUSPEX</div>
      <div className="text-sm text-neutral-300">
        {state.listening ? (
          <>
            listening on{' '}
            <span className="text-neutral-50 tabular-nums">
              {state.host}:{state.port}
            </span>{' '}
            — the augur is watching
          </>
        ) : state.error ? (
          <span className="text-red-400">listen failed: {state.error}</span>
        ) : (
          'starting listener...'
        )}
      </div>
      <button
        onClick={() => (demoRunning ? window.auspex.stopDemo() : window.auspex.runDemo())}
        disabled={!state.listening}
        className="rounded-[3px] border border-ember/40 px-4 py-2 text-sm text-ember transition-colors hover:bg-ember/10 disabled:opacity-50"
      >
        {demoRunning ? 'demo starting...' : 'run demo producers'}
      </button>
      <div className="text-sm text-neutral-300">
        or from a terminal: <span className="text-neutral-50 select-text">pnpm demo</span>
      </div>
    </div>
  )
}
