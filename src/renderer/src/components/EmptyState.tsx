import { PulseRegular } from '@fluentui/react-icons'

export function EmptyState({ state }: { state: AuspexServerState }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <PulseRegular className="text-7xl text-ember" />
      <div className="text-2xl tracking-[0.3em] text-neutral-50">AUSPEX</div>
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
      <div className="rounded-[3px] border border-hairline bg-panel px-3 py-1.5 text-sm text-neutral-300">
        try: <span className="text-ember select-text">pnpm demo</span>
      </div>
    </div>
  )
}
