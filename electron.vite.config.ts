import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const here = import.meta.dirname
const carapace = resolve(here, '../carapace')

export default defineConfig({
  main: {
    // Bundle the carapace window seam from source (it's link:ed). carapace ships ESM-only
    // package exports, which a CJS main process can't `require`; the seam is dep-free, so
    // bundling its source is clean (no chokidar — that lives in the fs seam, not this one).
    plugins: [externalizeDepsPlugin({ exclude: ['@carapace/shell'] })],
    resolve: {
      alias: {
        '@carapace/shell/node': resolve(carapace, 'packages/shell/src/window/node.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@carapace/shell'] })],
    resolve: {
      alias: {
        '@carapace/shell/ipc': resolve(carapace, 'packages/shell/src/fs/client.ts'),
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      // carapace is link:ed, so its @fluentui/react-icons dep would otherwise pull its own
      // React copy → "useContext of null" crash at runtime. Dedupe to the app's single React.
      dedupe: ['react', 'react-dom'],
      // Resolve @carapace/shell to its SOURCE (edit carapace, see it live; no rebuild step).
      // Subpath aliases must precede the prefix alias (Rollup alias = first match wins), else
      // '@carapace/shell/ipc' gets rewritten to '.../index.ts/ipc'.
      alias: {
        '@carapace/shell/ipc': resolve(carapace, 'packages/shell/src/fs/client.ts'),
        '@carapace/shell': resolve(carapace, 'packages/shell/src/index.ts'),
      },
    },
    server: {
      // carapace is a sibling repo (not a workspace member); let Vite serve its source files.
      fs: { allow: [here, carapace] },
    },
  },
})
