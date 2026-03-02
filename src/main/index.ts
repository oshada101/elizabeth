import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import log from 'electron-log'
import { db as appDb, streamAgent } from './agent'
import * as keyManager from './keyManager'

log.initialize()
log.info('App starting...')

let mainWindow: BrowserWindow | null = null

function initDatabase(): void {
  appDb.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pdf_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  appDb.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      role TEXT,
      content TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#2e1065',
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

ipcMain.handle('read-file', async (_event, filePath: string) => {
  try {
    const { readFileSync } = await import('fs')
    const buffer = readFileSync(filePath)
    return buffer
  } catch (error) {
    log.error('Error reading file:', error)
    return null
  }
})

ipcMain.handle('get-sessions', () => {
  try {
    const stmt = appDb.prepare('SELECT * FROM sessions ORDER BY updated_at DESC')
    return stmt.all()
  } catch (error) {
    log.error('Error getting sessions:', error)
    return []
  }
})

ipcMain.handle('create-session', (_event, pdfPath: string) => {
  try {
    const stmt = appDb.prepare('INSERT INTO sessions (pdf_path) VALUES (?)')
    const result = stmt.run(pdfPath)
    return result.lastInsertRowid
  } catch (error) {
    log.error('Error creating session:', error)
    return null
  }
})

ipcMain.handle('update-session', (_event, sessionId: number, pdfPath: string) => {
  const stmt = appDb.prepare('UPDATE sessions SET pdf_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
  stmt.run(pdfPath, sessionId)
})

ipcMain.handle('get-messages', (_event, sessionId: number) => {
  try {
    const stmt = appDb.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC')
    return stmt.all(sessionId)
  } catch (error) {
    log.error('Error getting messages:', error)
    return []
  }
})

ipcMain.handle('add-message', (_event, sessionId: number, role: string, content: string) => {
  try {
    const stmt = appDb.prepare('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)')
    const result = stmt.run(sessionId, role, content)
    const updateStmt = appDb.prepare('UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    updateStmt.run(sessionId)
    return result.lastInsertRowid
  } catch (error) {
    log.error('Error adding message:', error)
    return null
  }
})

ipcMain.handle('clear-messages', (_event, sessionId: number) => {
  const stmt = appDb.prepare('DELETE FROM messages WHERE session_id = ?')
  stmt.run(sessionId)
})

ipcMain.handle('ask', async (_, message: string, sessionId: number) => {
  const content = await streamAgent(
    [{ role: 'user', content: message }],
    {
      configurable: {
        thread_id: `session_${sessionId}`,
      },
    },
    mainWindow
  );
  return { content };
})

ipcMain.handle('api-keys:save', async (_event, data) => {
  return keyManager.saveApiKey(data)
})

ipcMain.handle('api-keys:list', async () => {
  return keyManager.getApiKeysMetadata()
})

ipcMain.handle('api-keys:delete', async (_event, id) => {
  return keyManager.deleteApiKey(id)
})

ipcMain.handle('api-keys:set-default', async (_event, id) => {
  return keyManager.setDefaultApiKey(id)
})

ipcMain.handle('api-keys:update', async (_event, id: string, data: { account?: string, provider?: string, label?: string, isDefault?: boolean, models?: string[], apiKey?: string, baseUrl?: string }) => {
  return keyManager.updateApiKey(id, data)
})

ipcMain.handle('window-minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})

ipcMain.handle('window-close', () => {
  mainWindow?.close()
})

app.whenReady().then(async () => {
  initDatabase()
  createWindow()
})

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
