import { useEffect, useState, useSyncExternalStore } from 'react'
import { Workbench, HostProvider, EditorTabs, StatusDot } from '@carapace/shell'
import { host } from './lib/host'
import { store } from './lib/store'
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
    <HostProvider host={host}>
      <Workbench
        draggable
        logo={
          <span className="font-sans text-sm font-semibold tracking-[0.25em] text-accent">
            AUSPEX
          </span>
        }
        statusBar={
          <StatusBar
            state={store.serverState}
            sessionCount={sessions.length}
            demoRunning={store.demoRunning}
          />
        }
      >
        <div className="flex h-full flex-col">
          {sessions.length > 0 && (
            <EditorTabs
              tabs={sessions.map(s => ({
                id: String(s.id),
                title: s.name ?? `session ${s.id}`,
                icon: (
                  <StatusDot
                    tone={s.status === 'live' ? 'success' : s.status === 'handshaking' ? 'warning' : 'neutral'}
                    pulse={s.status === 'live'}
                  />
                ),
              }))}
              activeId={active ? String(active.id) : null}
              onSelect={id => setActiveId(Number(id))}
              onClose={id => store.closeTab(Number(id))}
            />
          )}
          <main className="min-h-0 flex-1">
            {active ? (
              <div className="h-full font-mono">
                <SessionView session={active} />
              </div>
            ) : (
              <EmptyState state={store.serverState} demoRunning={store.demoRunning} />
            )}
          </main>
        </div>
      </Workbench>
    </HostProvider>
  )
}
