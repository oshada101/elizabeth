import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, dirname } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import log from 'electron-log'
import { db as appDb } from './db'
import { invokeAgent, processPdfDocument, getEmbeddedDocuments, switchToDocument, getCurrentDocumentId, deleteEmbeddedDocument } from './agent'
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

ipcMain.handle('delete-session', (_event, sessionId: number) => {
  try {
    const deleteMessages = appDb.prepare('DELETE FROM messages WHERE session_id = ?')
    deleteMessages.run(sessionId)
    const deleteSession = appDb.prepare('DELETE FROM sessions WHERE id = ?')
    deleteSession.run(sessionId)
    return true
  } catch (error) {
    log.error('Error deleting session:', error)
    return false
  }
})

ipcMain.handle('ask', async (event, message: string, sessionId: number) => {
  const response = await invokeAgent(
    [{ role: 'user', content: message }],
    { configurable: { thread_id: `session_${sessionId}` } },
    (chunk) => {
      event.sender.send('agent:chunk', chunk);
    },
    (toolCall) => {
      event.sender.send('agent:tool', toolCall);
    }
  );
  return response;
});


ipcMain.handle('load-pdf-text', async (event, pdfData: Uint8Array, filePath: string, sessionId: number) => {
  try {
    log.info("loading pdf")

    const fileName = filePath.split(/[\\/]/).pop() || 'document.pdf';
    const result = await processPdfDocument(pdfData, filePath, fileName, (progress: number) => {
      event.sender.send('embedding:progress', progress);
    });

    if (result.isNew) {
      log.info(`Embedded new document: ${result.chunkCount} chunks`);
    } else {
      log.info(`Using existing embedding: ${result.chunkCount} chunks`);
    }

    return result.hash;
  } catch (error) {
    log.error('Error processing PDF:', error);
    return null;
  }
});

// Get list of all embedded documents
ipcMain.handle('documents:list', async () => {
  log.info('IPC: documents:list called')
  const docs = getEmbeddedDocuments()
  log.info(`IPC: returning ${docs.length} documents`)
  return docs
})

// Switch to a different document without re-embedding
ipcMain.handle('documents:switch', async (_, hash: string) => {
  log.info('IPC: documents:switch called for', hash)
  return switchToDocument(hash)
})

// Get current document hash
ipcMain.handle('documents:current', async () => {
  log.info('IPC: documents:current called')
  return getCurrentDocumentId()
})

// Delete a document
ipcMain.handle('documents:delete', async (_, hash: string) => {
  log.info('IPC: documents:delete called for', hash)
  return deleteEmbeddedDocument(hash)
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

// File System Operations
ipcMain.handle('fs:get-home-dir', () => {
  const home = homedir()
  log.info('Home directory:', home)
  return home
})

ipcMain.handle('fs:get-default-dir', () => {
  const home = homedir()
  const docsPath = join(home, 'Documents')
  if (existsSync(docsPath)) {
    log.info('Default directory (Documents):', docsPath)
    return docsPath
  }
  log.info('Default directory (home):', home)
  return home
})

ipcMain.handle('fs:read-dir', async (_, dirPath: string) => {
  try {
    log.info('fs:read-dir called with path:', dirPath)
    if (!existsSync(dirPath)) {
      log.error('Directory does not exist:', dirPath)
      return null
    }
    const entries = readdirSync(dirPath, { withFileTypes: true })
    const files = entries.map(entry => {
      const fullPath = join(dirPath, entry.name)
      const stats = statSync(fullPath)
      return {
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory(),
        size: stats.size,
        modified: stats.mtime.toISOString()
      }
    })
    // Sort: directories first, then files, both alphabetically
    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    })
    return files
  } catch (error) {
    log.error('Error reading directory:', error)
    return null
  }
})

ipcMain.handle('fs:get-parent-dir', async (_, dirPath: string) => {
  try {
    const parent = dirname(dirPath)
    if (parent === dirPath) return null // Root reached
    return parent
  } catch (error) {
    log.error('Error getting parent directory:', error)
    return null
  }
})

ipcMain.handle('fs:exists', async (_, filePath: string) => {
  return existsSync(filePath)
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
