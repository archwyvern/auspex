import { PulseRegular } from '@fluentui/react-icons'
import { Button } from '@carapace/shell'

export function EmptyState({ state, demoRunning }: { state: AuspexServerState; demoRunning: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <PulseRegular className="text-7xl text-accent" />
      <div className="font-sans text-2xl font-semibold tracking-[0.3em] text-fg">AUSPEX</div>
      <div className="text-base text-fg-mid">
        {state.listening ? (
          <>
            listening on{' '}
            <span className="text-fg tabular-nums">
              {state.host}:{state.port}
            </span>{' '}
            — the augur is watching
          </>
        ) : state.error ? (
          <span className="text-error">listen failed: {state.error}</span>
        ) : (
          'starting listener...'
        )}
      </div>
      <Button
        variant="accent"
        size="md"
        disabled={!state.listening}
        onClick={() => (demoRunning ? window.auspex.stopDemo() : window.auspex.runDemo())}
      >
        {demoRunning ? 'demo starting...' : 'run demo producers'}
      </Button>
      <div className="text-base text-fg-mid">
        or from a terminal: <span className="text-fg select-text">pnpm demo</span>
      </div>
    </div>
  )
}
