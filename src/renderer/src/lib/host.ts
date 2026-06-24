import type { CarapaceHost } from '@carapace/shell'
import { createIpcWindow } from '@carapace/shell/ipc'

/**
 * Auspex's implementation of carapace's host seam. Auspex is a profiler viewer, not a file
 * editor, so there is no `fs` adapter (it's optional) — window controls come from carapace's
 * window seam (createIpcWindow over the preload-exposed bridge), plus the platform clipboard
 * and stubbed dialogs.
 */
export const host: CarapaceHost = {
  window: createIpcWindow(window.carapaceWindow),
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
