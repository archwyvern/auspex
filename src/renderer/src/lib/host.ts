import type { CarapaceHost } from '@carapace/shell'

/**
 * Auspex's implementation of carapace's host seam. Auspex is a profiler viewer, not a
 * file editor, so there is no `fs` adapter (it's optional) — only window controls over the
 * preload bridge (for the frameless TopBar), the platform clipboard, and stubbed dialogs.
 */
export const host: CarapaceHost = {
  window: {
    minimize: () => void window.auspex.windowMinimize(),
    toggleMaximize: () => window.auspex.windowToggleMaximize(),
    close: () => void window.auspex.windowClose(),
    isMaximized: () => window.auspex.windowIsMaximized(),
    onMaximizeChanged: (cb) => window.auspex.onWindowMaximized(cb),
  },
  dialog: {
    openFile: async () => null,
    saveFile: async () => null,
    message: async () => {},
  },
  clipboard: {
    writeText: (text) => navigator.clipboard.writeText(text),
    readText: () => navigator.clipboard.readText(),
  },
}
