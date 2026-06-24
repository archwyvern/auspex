import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

export type ServerState = {
  listening: boolean
  host: string
  port: number
  error: string | null
}

export type SessionEvent =
  | { type: 'open'; id: number }
  | { type: 'data'; id: number; chunk: Uint8Array }
  | { type: 'close'; id: number }

const api = {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  // Signals the main process that the renderer is mounted and wants the
  // session replay. Safe to call on every mount, including HMR reloads.
  ready(): void {
    ipcRenderer.send('auspex:ready')
  },
  onServerState(callback: (state: ServerState) => void): () => void {
    const listener = (_event: IpcRendererEvent, state: ServerState) => callback(state)
    ipcRenderer.on('auspex:server-state', listener)
    return () => ipcRenderer.off('auspex:server-state', listener)
  },
  onSessionEvent(callback: (event: SessionEvent) => void): () => void {
    const listener = (_event: IpcRendererEvent, sessionEvent: SessionEvent) => callback(sessionEvent)
    ipcRenderer.on('auspex:session', listener)
    return () => ipcRenderer.off('auspex:session', listener)
  },
  runDemo(): void {
    ipcRenderer.send('auspex:demo-run')
  },
  stopDemo(): void {
    ipcRenderer.send('auspex:demo-stop')
  },
  onDemoState(callback: (state: { running: boolean }) => void): () => void {
    const listener = (_event: IpcRendererEvent, state: { running: boolean }) => callback(state)
    ipcRenderer.on('auspex:demo-state', listener)
    return () => ipcRenderer.off('auspex:demo-state', listener)
  },
  // Window controls for carapace's frameless TopBar (the host.window seam).
  windowMinimize(): Promise<void> {
    return ipcRenderer.invoke('auspex:window-minimize')
  },
  windowToggleMaximize(): Promise<void> {
    return ipcRenderer.invoke('auspex:window-toggle-maximize')
  },
  windowClose(): Promise<void> {
    return ipcRenderer.invoke('auspex:window-close')
  },
  windowIsMaximized(): Promise<boolean> {
    return ipcRenderer.invoke('auspex:window-is-maximized')
  },
  onWindowMaximized(callback: (max: boolean) => void): () => void {
    const listener = (_event: IpcRendererEvent, max: boolean) => callback(max)
    ipcRenderer.on('auspex:window-maximized', listener)
    return () => ipcRenderer.off('auspex:window-maximized', listener)
  },
}

contextBridge.exposeInMainWorld('auspex', api)
