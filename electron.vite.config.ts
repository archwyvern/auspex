import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const here = import.meta.dirname
const carapace = resolve(here, '../carapace')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      // carapace is link:ed, so its @fluentui/react-icons dep would otherwise pull its own
      // React copy → "useContext of null" crash at runtime. Dedupe to the app's single React.
      dedupe: ['react', 'react-dom'],
      // Resolve @carapace/shell to its SOURCE (edit carapace, see it live; no rebuild step).
      alias: {
        '@carapace/shell': resolve(carapace, 'packages/shell/src/index.ts'),
      },
    },
    server: {
      // carapace is a sibling repo (not a workspace member); let Vite serve its source files.
      fs: { allow: [here, carapace] },
    },
  },
})
