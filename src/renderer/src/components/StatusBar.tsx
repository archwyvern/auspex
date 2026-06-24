import { StatusBar as ShellStatusBar, StatusDot, Button } from '@carapace/shell'
import { Kbd } from './Kbd'

type StatusBarProps = {
  state: AuspexServerState
  sessionCount: number
  demoRunning: boolean
}

export function StatusBar({ state, sessionCount, demoRunning }: StatusBarProps) {
  const tone = state.listening ? 'success' : state.error ? 'error' : 'neutral'
  return (
    <ShellStatusBar
      left={
        <>
          <span className="flex items-center gap-2">
            <StatusDot tone={tone} pulse={state.listening} />
            {state.listening ? (
              <span>
                listening{' '}
                <span className="text-fg tabular-nums">
                  {state.host}:{state.port}
                </span>
              </span>
            ) : state.error ? (
              <span className="text-error">listen failed: {state.error}</span>
            ) : (
              <span>starting...</span>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>ctrl</Kbd>
            <Kbd>←</Kbd>
            <Kbd>→</Kbd> tabs
          </span>
        </>
      }
      right={
        <>
          <Button
            variant={demoRunning ? 'accent' : 'ghost'}
            size="sm"
            onClick={() => (demoRunning ? window.auspex.stopDemo() : window.auspex.runDemo())}
          >
            {demoRunning ? 'stop demo' : 'run demo'}
          </Button>
          <span>
            <span className="text-fg tabular-nums">{sessionCount}</span> session
            {sessionCount === 1 ? '' : 's'}
          </span>
          <span>electron {window.auspex.versions.electron}</span>
        </>
      }
    />
  )
}
