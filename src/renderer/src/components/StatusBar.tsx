export function StatusBar({ state, sessionCount }: { state: AuspexServerState; sessionCount: number }) {
  return (
    <div className="flex h-7 items-center gap-3 border-t border-hairline bg-panel px-3 text-sm">
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
      <span className="flex-1" />
      <span className="text-neutral-300">
        <span className="text-neutral-50 tabular-nums">{sessionCount}</span> session
        {sessionCount === 1 ? '' : 's'}
      </span>
      <span className="text-neutral-300">electron {window.auspex.versions.electron}</span>
    </div>
  )
}
