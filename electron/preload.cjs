const { contextBridge, ipcRenderer } = require('electron')
const authCallbacks = new Set()
let pendingAuthUrl = null

ipcRenderer.on('clary-auth-callback', (_event, url) => {
  if (authCallbacks.size === 0) {
    pendingAuthUrl = url
    return
  }
  authCallbacks.forEach((callback) => callback(url))
})

contextBridge.exposeInMainWorld('claryDesktop', {
  platform: process.platform,
  onAuthCallback(callback) {
    authCallbacks.add(callback)
    if (pendingAuthUrl) {
      callback(pendingAuthUrl)
      pendingAuthUrl = null
    }
    return () => authCallbacks.delete(callback)
  },
})