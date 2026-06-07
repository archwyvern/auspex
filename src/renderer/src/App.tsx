import { useEffect, useState, useSyncExternalStore } from 'react'
import { store } from './lib/store'
import { TabStrip } from './components/TabStrip'
import { SessionView } from './components/SessionView'
import { EmptyState } from './components/EmptyState'
import { StatusBar } from './components/StatusBar'

export default function App() {
  useSyncExternalStore(store.subscribe, store.getVersion)
  const [activeId, setActiveId] = useState<number | null>(null)

  useEffect(() => {
    store.onSessionOpened = id => setActiveId(id)
    store.start()
    return () => {
      store.onSessionOpened = null
    }
  }, [])

  // ctrl+arrows cycle session tabs.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight')) return
      event.preventDefault()
      const delta = event.code === 'ArrowLeft' ? -1 : 1
      setActiveId(prev => {
        const order = store.order
        if (order.length === 0) return prev
        const index = prev !== null ? order.indexOf(prev) : -1
        const base = index < 0 ? order.length - 1 : index
        return order[(base + delta + order.length) % order.length]
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const sessions = store.order
    .map(id => store.sessions.get(id))
    .filter((session): session is NonNullable<typeof session> => session !== undefined)

  const active =
    (activeId !== null ? store.sessions.get(activeId) : undefined) ?? sessions[sessions.length - 1]

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-10 shrink-0 items-stretch border-b border-hairline bg-panel-bright">
        <div className="flex items-center gap-2 border-r border-hairline px-3">
          <span className="font-display text-sm font-semibold tracking-[0.25em] text-ember">AUSPEX</span>
        </div>
        <TabStrip
          sessions={sessions}
          activeId={active?.id ?? null}
          onSelect={setActiveId}
          onClose={id => store.closeTab(id)}
        />
      </header>

      <main className="min-h-0 flex-1">
        {active ? (
          <SessionView session={active} />
        ) : (
          <EmptyState state={store.serverState} demoRunning={store.demoRunning} />
        )}
      </main>

      <StatusBar
        state={store.serverState}
        sessionCount={sessions.length}
        demoRunning={store.demoRunning}
      />
    </div>
  )
}
