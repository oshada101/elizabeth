import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import log from 'electron-log'
import initSqlJs, { Database } from 'sql.js'
import { invokeAgent } from './agent'
import * as keyManager from './keyManager'

log.initialize()
log.info('App starting...')

let mainWindow: BrowserWindow | null = null
let db: Database | null = null

const userDataPath = app.getPath('userData')
const dbPath = join(userDataPath, 'app.db')
const keysMetadataPath = join(userDataPath, 'api-keys.json')

async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs()

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pdf_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      role TEXT,
      content TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `)

  saveDatabase()
}

function saveDatabase(): void {
  if (db) {
    const data = db.export()
    const buffer = Buffer.from(data)
    writeFileSync(dbPath, buffer)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#2e1065',
    frame: false,
    titleBarStyle: 'hidden',     // or 'hiddenInset'
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
    const buffer = readFileSync(filePath)
    return buffer
  } catch (error) {
    log.error('Error reading file:', error)
    return null
  }
})

ipcMain.handle('get-sessions', () => {
  if (!db) {
    log.error('Database not initialized in getSessions')
    return []
  }
  try {
    const result = db.exec('SELECT * FROM sessions ORDER BY updated_at DESC')
    if (result.length === 0) return []
    return result[0].values.map(row => ({
      id: row[0],
      pdf_path: row[1],
      created_at: row[2],
      updated_at: row[3]
    }))
  } catch (error) {
    log.error('Error getting sessions:', error)
    return []
  }
})

ipcMain.handle('create-session', (_event, pdfPath: string) => {
  if (!db) {
    log.error('Database not initialized')
    return null
  }
  try {
    db.run('INSERT INTO sessions (pdf_path) VALUES (?)', [pdfPath])
    saveDatabase()
    const result = db.exec('SELECT last_insert_rowid()')
    if (result.length === 0 || result[0].values.length === 0) {
      log.error('Failed to get last insert rowid')
      return null
    }
    return result[0].values[0][0]
  } catch (error) {
    log.error('Error creating session:', error)
    return null
  }
})

ipcMain.handle('update-session', (_event, sessionId: number, pdfPath: string) => {
  if (!db) return
  db.run('UPDATE sessions SET pdf_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [pdfPath, sessionId])
  saveDatabase()
})

ipcMain.handle('get-messages', (_event, sessionId: number) => {
  if (!db) return []
  const result = db.exec('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC', [sessionId])
  if (result.length === 0) return []
  return result[0].values.map(row => ({
    id: row[0],
    session_id: row[1],
    role: row[2],
    content: row[3],
    timestamp: row[4]
  }))
})

ipcMain.handle('add-message', (_event, sessionId: number, role: string, content: string) => {
  if (!db) return
  db.run('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)', [sessionId, role, content])
  db.run('UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [sessionId])
  saveDatabase()
  const result = db.exec('SELECT last_insert_rowid()')
  return result[0].values[0][0]
})

ipcMain.handle('clear-messages', (_event, sessionId: number) => {
  if (!db) return
  db.run('DELETE FROM messages WHERE session_id = ?', [sessionId])
  saveDatabase()
})

ipcMain.handle('ask', async (_, message: string) => {
  const response = await invokeAgent({
    messages: [{ role: 'user', content: message }],
  }, {
    configurable: {
      thread_id: "thread_1",
    },
  })
  return response
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
  await initDatabase()
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
