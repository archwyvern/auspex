import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serveWindow } from '@carapace/shell/node'
import { ProfilerServer } from './server'
import { DemoRunner } from './demoRunner'

const profilerServer = new ProfilerServer()
const demoRunner = new DemoRunner()

// `--screenshot <path>`: capture the rendered window to a PNG and exit (headless verification).
const screenshotIndex = process.argv.indexOf('--screenshot')
const screenshotPath = screenshotIndex >= 0 ? process.argv[screenshotIndex + 1] : null
// `--demo`: auto-start the demo producers on load (handy with --screenshot for a populated capture).
const autoDemo = process.argv.includes('--demo')

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1600,
    height: 900,
    show: false,
    // Frameless: carapace's TopBar is the title bar (logo + window controls + drag region).
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0c10',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
    },
  })
  mainWindow = window

  window.on('ready-to-show', () => window.show())

  if (autoDemo) {
    window.webContents.once('did-finish-load', () => demoRunner.start())
  }

  if (screenshotPath) {
    window.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void window.webContents.capturePage().then(image => {
          writeFileSync(screenshotPath, image.toPNG())
          app.quit()
        })
      }, autoDemo ? 4500 : 1500)
    })
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  profilerServer.attach(window.webContents)
  demoRunner.attach(window.webContents)

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  ipcMain.on('auspex:ready', () => {
    profilerServer.onRendererReady()
    demoRunner.sendState()
  })
  ipcMain.on('auspex:demo-run', () => demoRunner.start())
  ipcMain.on('auspex:demo-stop', () => demoRunner.stop())

  // Carapace window-control seam — backs the frameless TopBar's min/max/close controls.
  serveWindow(ipcMain, () => mainWindow)

  profilerServer.start()
  createWindow()
})

app.on('window-all-closed', () => {
  demoRunner.stop()
  profilerServer.stop()
  app.quit()
})
