import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { ProfilerServer } from './server'

const profilerServer = new ProfilerServer()

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1600,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0c10',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
    },
  })

  window.on('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  profilerServer.attach(window.webContents)

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  ipcMain.on('auspex:ready', () => profilerServer.onRendererReady())
  profilerServer.start()
  createWindow()
})

app.on('window-all-closed', () => {
  profilerServer.stop()
  app.quit()
})
