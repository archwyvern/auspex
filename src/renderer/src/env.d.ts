/// <reference types="vite/client" />

declare global {
  type AuspexServerState = {
    listening: boolean
    host: string
    port: number
    error: string | null
  }

  type AuspexSessionEvent =
    | { type: 'open'; id: number }
    | { type: 'data'; id: number; chunk: Uint8Array }
    | { type: 'close'; id: number }

  interface Window {
    auspex: {
      versions: {
        electron: string
        chrome: string
      }
      ready: () => void
      onServerState: (callback: (state: AuspexServerState) => void) => () => void
      onSessionEvent: (callback: (event: AuspexSessionEvent) => void) => () => void
      runDemo: () => void
      stopDemo: () => void
      onDemoState: (callback: (state: { running: boolean }) => void) => () => void
      windowMinimize: () => Promise<void>
      windowToggleMaximize: () => Promise<void>
      windowClose: () => Promise<void>
      windowIsMaximized: () => Promise<boolean>
      onWindowMaximized: (callback: (max: boolean) => void) => () => void
    }
  }
}

export {}
