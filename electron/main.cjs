const { app, BrowserWindow, session } = require('electron')
const path = require('node:path')

const authScheme = 'clary'
let mainWindow
let pendingAuthUrl = process.argv.find((argument) => argument.startsWith(`${authScheme}://`))

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(authScheme, process.execPath, [path.resolve(process.argv[1])])
} else {
  app.setAsDefaultProtocolClient(authScheme)
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

function sendAuthUrl(url) {
  pendingAuthUrl = url
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('clary-auth-callback', pendingAuthUrl)
    pendingAuthUrl = null
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'CLARY',
    icon: path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'), 'Logo.png'),
    backgroundColor: '#f8f6fc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingAuthUrl) {
      mainWindow.webContents.send('clary-auth-callback', pendingAuthUrl)
      pendingAuthUrl = null
    }
  })
  mainWindow.on('closed', () => { mainWindow = null })

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  } else {
    mainWindow.loadURL('http://127.0.0.1:5173')
  }
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    const authUrl = commandLine.find((argument) => argument.startsWith(`${authScheme}://`))
    if (authUrl) sendAuthUrl(authUrl)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.on('open-url', (event, url) => {
    event.preventDefault()
    sendAuthUrl(url)
  })

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const isMainWindow = mainWindow && webContents.id === mainWindow.webContents.id
      const requestingUrl = details.requestingUrl ?? ''
      const trustedOrigin = app.isPackaged ? requestingUrl.startsWith('file://') : requestingUrl.startsWith('http://127.0.0.1:5173')
      const mediaAllowed = permission === 'media'
        && Boolean(details.mediaTypes?.length)
        && details.mediaTypes?.every((mediaType) => mediaType === 'audio' || mediaType === 'video')
      callback(Boolean(isMainWindow && trustedOrigin && mediaAllowed))
    })
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
      const isMainWindow = mainWindow && webContents?.id === mainWindow.webContents.id
      const trustedOrigin = app.isPackaged
        ? requestingOrigin.startsWith('file://')
        : requestingOrigin.startsWith('http://127.0.0.1:5173')
      return Boolean(isMainWindow && trustedOrigin && permission === 'media')
    })
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}