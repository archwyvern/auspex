/// <reference types="vite/client" />

import type { WindowBridge } from '@carapace/shell/ipc'

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
    }
    carapaceWindow: WindowBridge
  }
}

export {}
