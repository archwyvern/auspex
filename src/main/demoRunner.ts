import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { app, type WebContents } from 'electron'

// Spawns the demo producers as a child process, using Electron's own binary
// in node mode (ELECTRON_RUN_AS_NODE) so no system node is required. Dev
// affordance: paths resolve within the repo checkout.
export class DemoRunner {
  private child: ChildProcess | null = null
  private webContents: WebContents | null = null

  attach(webContents: WebContents): void {
    this.webContents = webContents
  }

  start(): void {
    if (this.child) return
    const root = app.getAppPath()
    const child = spawn(
      process.execPath,
      [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(root, 'demo', 'src', 'main.ts')],
      {
        cwd: root,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: 'ignore',
      },
    )
    this.child = child
    child.on('exit', () => {
      this.child = null
      this.sendState()
    })
    child.on('error', () => {
      this.child = null
      this.sendState()
    })
    this.sendState()
  }

  stop(): void {
    this.child?.kill()
  }

  sendState(): void {
    if (!this.webContents || this.webContents.isDestroyed()) return
    this.webContents.send('auspex:demo-state', { running: this.child !== null })
  }
}
