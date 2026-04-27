import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, dirname } from 'path'
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'fs'
import { homedir } from 'os'
import log from 'electron-log'
import { db as appDb } from './db'
let _agent: typeof import('./agent') | null = null
async function getAgent() {
  if (!_agent) _agent = await import('./agent')
  return _agent
}
import { updateDocumentPath, getDocumentsByPath } from './documentRegistry'
import * as keyManager from './keyManager'
import { getEmbeddingSettings, saveEmbeddingSettings } from './settingsManager'

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
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
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

ipcMain.handle('ask', async (event, message: string, sessionId: number, currentPath: string) => {
  const { invokeAgent } = await getAgent()
  const response = await invokeAgent(
    [{ role: 'user', content: message }],
    { configurable: { thread_id: `session_${sessionId}` } },
    currentPath,
    (chunk: string) => {
      event.sender.send('agent:chunk', chunk);
    },
    (toolCall: any) => {
      event.sender.send('agent:tool', toolCall);
    }
  );
  return response;
});


ipcMain.handle('load-pdf-text', async (event, pdfData: Uint8Array, filePath: string, sessionId: number) => {
  try {
    log.info("loading pdf")

    const fileName = filePath.split(/[\\/]/).pop() || 'document.pdf';
    const { processPdfDocument } = await getAgent()
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

// Recursively find all PDF files in a directory
function findPdfsRecursive(dirPath: string): string[] {
  const pdfs: string[] = []
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        pdfs.push(...findPdfsRecursive(fullPath))
      } else if (entry.name.toLowerCase().endsWith('.pdf')) {
        pdfs.push(fullPath)
      }
    }
  } catch (error) {
    log.error('Error scanning directory for PDFs:', dirPath, error)
  }
  return pdfs
}

// Batch embed all PDFs in a directory
ipcMain.handle('embed-directory-pdfs', async (event, dirPath: string) => {
  try {
    log.info('Batch embedding PDFs from:', dirPath)
    const pdfPaths = findPdfsRecursive(dirPath)
    log.info(`Found ${pdfPaths.length} PDFs to embed`)

    if (pdfPaths.length === 0) {
      event.sender.send('batch-embedding:done', { totalFiles: 0 })
      return { totalFiles: 0 }
    }

    for (let i = 0; i < pdfPaths.length; i++) {
      const filePath = pdfPaths[i]
      const fileName = filePath.split(/[\\/]/).pop() || 'document.pdf'

      event.sender.send('batch-embedding:file-start', {
        fileName,
        filePath,
        fileIndex: i,
        totalFiles: pdfPaths.length
      })

      try {
        const pdfData = readFileSync(filePath)
        const { processPdfDocument } = await getAgent()
        const result = await processPdfDocument(
          new Uint8Array(pdfData),
          filePath,
          fileName,
          (progress: number) => {
            event.sender.send('batch-embedding:file-progress', {
              fileName,
              progress,
              fileIndex: i,
              totalFiles: pdfPaths.length
            })
          }
        )

        event.sender.send('batch-embedding:file-done', {
          fileName,
          hash: result.hash,
          isNew: result.isNew,
          chunkCount: result.chunkCount,
          fileIndex: i,
          totalFiles: pdfPaths.length
        })
      } catch (error) {
        log.error(`Error embedding ${fileName}:`, error)
        event.sender.send('batch-embedding:file-done', {
          fileName,
          hash: null,
          isNew: false,
          chunkCount: 0,
          fileIndex: i,
          totalFiles: pdfPaths.length,
          error: true
        })
      }
    }

    event.sender.send('batch-embedding:done', { totalFiles: pdfPaths.length })
    return { totalFiles: pdfPaths.length }
  } catch (error) {
    log.error('Error in batch embedding:', error)
    event.sender.send('batch-embedding:done', { totalFiles: 0, error: true })
    return { totalFiles: 0, error: true }
  }
})

// Get list of all embedded documents
ipcMain.handle('documents:list', async () => {
  log.info('IPC: documents:list called')
  const { getEmbeddedDocuments } = await getAgent()
  const docs = getEmbeddedDocuments()
  log.info(`IPC: returning ${docs.length} documents`)
  return docs
})

// Switch to a different document without re-embedding
ipcMain.handle('documents:switch', async (_, hash: string) => {
  log.info('IPC: documents:switch called for', hash)
  const { switchToDocument } = await getAgent()
  return switchToDocument(hash)
})

// Get current document hash
ipcMain.handle('documents:current', async () => {
  log.info('IPC: documents:current called')
  const { getCurrentDocumentId } = await getAgent()
  return getCurrentDocumentId()
})

// Delete a document
ipcMain.handle('documents:delete', async (_, hash: string) => {
  log.info('IPC: documents:delete called for', hash)
  const { deleteEmbeddedDocument } = await getAgent()
  return deleteEmbeddedDocument(hash)
})

// Get count of documents in a directory path (including subdirectories)
ipcMain.handle('documents:countByPath', async (_, dirPath: string) => {
  log.info('IPC: documents:countByPath called for', dirPath)
  const docs = getDocumentsByPath(dirPath)
  return docs.length
})

// Delete all documents in a directory path (including subdirectories)
ipcMain.handle('documents:deleteByPath', async (_, dirPath: string) => {
  log.info('IPC: documents:deleteByPath called for', dirPath)
  const docs = getDocumentsByPath(dirPath)
  const { deleteEmbeddedDocument } = await getAgent()
  let deletedCount = 0
  for (const doc of docs) {
    try {
      await deleteEmbeddedDocument(doc.id)
      deletedCount++
    } catch (error) {
      log.error(`Error deleting document ${doc.id}:`, error)
    }
  }
  return deletedCount
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

ipcMain.handle('settings:getEmbedding', () => {
  return getEmbeddingSettings()
})

ipcMain.handle('settings:saveEmbedding', (_event, settings: { model: string, baseUrl: string, embeddingDim: number }) => {
  saveEmbeddingSettings(settings)
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

ipcMain.handle('fs:list-tree', async (_, dirPath: string) => {
  try {
    interface TreeEntry {
      name: string;
      path: string;
      isDirectory: boolean;
      children?: TreeEntry[];
    }
    function scanDir(path: string): TreeEntry[] {
      const entries = readdirSync(path, { withFileTypes: true });
      return entries.map(entry => {
        const fullPath = join(path, entry.name);
        const stats = statSync(fullPath);
        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: fullPath,
            isDirectory: true,
            children: scanDir(fullPath)
          };
        }
        return {
          name: entry.name,
          path: fullPath,
          isDirectory: false,
          size: stats.size,
          modified: stats.mtime.toISOString()
        };
      });
    }
    return scanDir(dirPath);
  } catch (error) {
    log.error('Error listing tree:', error);
    return [];
  }
})

ipcMain.handle('fs:move-file', async (_, oldPath: string, newPath: string) => {
  try {
    const stats = statSync(oldPath);
    renameSync(oldPath, newPath);
    if (oldPath.toLowerCase().endsWith('.pdf')) {
      updateDocumentPath(oldPath, newPath);
    }
    log.info(`Moved ${oldPath} to ${newPath}`);
    return { success: true };
  } catch (error) {
    log.error('Error moving file:', error);
    return { success: false, error: String(error) };
  }
})

ipcMain.handle('fs:create-directory', async (_, dirPath: string) => {
  try {
    mkdirSync(dirPath, { recursive: true });
    log.info(`Created directory: ${dirPath}`);
    return { success: true };
  } catch (error) {
    log.error('Error creating directory:', error);
    return { success: false, error: String(error) };
  }
})

ipcMain.handle('fs:delete', async (_, targetPath: string) => {
  try {
    const stats = statSync(targetPath);
    if (stats.isDirectory()) {
      rmSync(targetPath, { recursive: true });
    } else {
      rmSync(targetPath);
    }
    log.info(`Deleted: ${targetPath}`);
    return { success: true };
  } catch (error) {
    log.error('Error deleting:', error);
    return { success: false, error: String(error) };
  }
})

ipcMain.handle('fs:delete-files', async (_, files: string[]) => {
  const results: { path: string; success: boolean; error?: string }[] = [];
  for (const filePath of files) {
    try {
      if (!existsSync(filePath)) {
        results.push({ path: filePath, success: false, error: 'Not found' });
        continue;
      }
      const stats = statSync(filePath);
      if (!stats.isDirectory() && filePath.toLowerCase().endsWith('.pdf')) {
        const docs = getDocumentsByPath(filePath);
        for (const doc of docs) {
          if (doc.file_path === filePath) {
            const { deleteEmbeddedDocument } = await getAgent()
          await deleteEmbeddedDocument(doc.id);
          }
        }
      }
      rmSync(filePath, { recursive: true, force: true });
      results.push({ path: filePath, success: true });
    } catch (e) {
      log.error(`Error deleting ${filePath}:`, e);
      results.push({ path: filePath, success: false, error: String(e) });
    }
  }
  const successCount = results.filter(r => r.success).length;
  return { success: successCount > 0, successCount, failedCount: results.length - successCount, results };
})

ipcMain.handle('fs:move-files', async (_, moves: { from: string; to: string }[]) => {
  const results: { from: string; to: string; success: boolean; error?: string }[] = [];
  for (const move of moves) {
    try {
      const destDir = dirname(move.to);
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
      }
      renameSync(move.from, move.to);
      if (move.from.toLowerCase().endsWith('.pdf')) {
        updateDocumentPath(move.from, move.to);
      }
      results.push({ from: move.from, to: move.to, success: true });
    } catch (e) {
      log.error(`Error moving ${move.from} to ${move.to}:`, e);
      results.push({ from: move.from, to: move.to, success: false, error: String(e) });
    }
  }
  const successCount = results.filter(r => r.success).length;
  return { success: successCount > 0, successCount, failedCount: results.length - successCount, results };
})

ipcMain.handle('fs:organize-folder', async (event, options: { targetPath: string, action: string, strategy?: string, flatten?: boolean, customGroups?: { folder: string; filePaths: string[] }[] }) => {
  try {
    const { targetPath, strategy = 'type', flatten = false } = options;

    // Custom groups (from semantic organize)
    if (options.customGroups && options.customGroups.length > 0) {
      const results: { oldPath: string; newPath: string }[] = [];
      for (const group of options.customGroups) {
        const groupDir = join(targetPath, group.folder);
        if (!existsSync(groupDir)) {
          mkdirSync(groupDir, { recursive: true });
        }
        for (const oldPath of group.filePaths) {
          if (!existsSync(oldPath)) continue;
          const fileName = oldPath.split(/[\\/]/).pop() || '';
          const newPath = join(groupDir, fileName);
          if (oldPath !== newPath) {
            renameSync(oldPath, newPath);
            if (oldPath.toLowerCase().endsWith('.pdf')) {
              updateDocumentPath(oldPath, newPath);
            }
            results.push({ oldPath, newPath });
          }
        }
      }
      log.info(`Custom organized ${results.length} files`);
      return { success: true, moved: results.length, strategy: 'custom' };
    }
    
    function getAllFiles(dirPath: string): string[] {
      const allFiles: string[] = [];
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dirPath, entry.name);
          if (entry.isDirectory()) {
            allFiles.push(...getAllFiles(fullPath));
          } else {
            allFiles.push(fullPath);
          }
        }
      } catch (e) {
        log.error('Error scanning directory:', e);
      }
      return allFiles;
    }
    
    const allFiles = getAllFiles(targetPath);
    const groups: Record<string, string[]> = {};
    
    for (const filePath of allFiles) {
      const fileName = filePath.split(/[\\/]/).pop() || '';
      let groupKey: string;
      
      if (flatten) {
        groupKey = "Root";
      } else if (strategy === 'type') {
        const ext = fileName.split('.').pop()?.toLowerCase() || 'unknown';
        groupKey = ext === 'pdf' ? 'PDFs' : ext.toUpperCase() + 's';
      } else if (strategy === 'date') {
        const stats = statSync(filePath);
        groupKey = stats.mtime.getFullYear().toString();
      } else {
        const nameParts = fileName.split(/[\s_-]/);
        groupKey = nameParts[0] || 'Other';
      }
      
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(filePath);
    }
    
    const results: { oldPath: string; newPath: string }[] = [];
    
    if (flatten) {
      const usedNames = new Set<string>();
      for (const oldPath of allFiles) {
        let fileName = oldPath.split(/[\\/]/).pop() || '';
        const baseName = fileName.replace(/\.[^.]+$/, '');
        const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';
        
        let newName = fileName;
        let counter = 1;
        while (usedNames.has(newName)) {
          newName = `${baseName}_${counter}${ext}`;
          counter++;
        }
        usedNames.add(newName);
        
        const newPath = join(targetPath, newName);
        if (oldPath !== newPath) {
          renameSync(oldPath, newPath);
          if (oldPath.toLowerCase().endsWith('.pdf')) {
            updateDocumentPath(oldPath, newPath);
          }
          results.push({ oldPath, newPath });
        }
      }
      
      // Clean up empty subfolders
      try {
        const entries = readdirSync(targetPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subPath = join(targetPath, entry.name);
            const subFiles = readdirSync(subPath);
            if (subFiles.length === 0) {
              rmSync(subPath, { recursive: true });
            }
          }
        }
      } catch (e) {}
    } else {
      for (const [group, paths] of Object.entries(groups)) {
        const groupDir = join(targetPath, group);
        if (!existsSync(groupDir)) {
          mkdirSync(groupDir, { recursive: true });
        }
        
        for (const oldPath of paths) {
          const fileName = oldPath.split(/[\\/]/).pop() || '';
          const newPath = join(groupDir, fileName);
          if (oldPath !== newPath) {
            renameSync(oldPath, newPath);
            if (oldPath.toLowerCase().endsWith('.pdf')) {
              updateDocumentPath(oldPath, newPath);
            }
            results.push({ oldPath, newPath });
          }
        }
      }
    }
    
    log.info(`Organized ${results.length} files with strategy: ${flatten ? 'flatten' : strategy}`);
    return { success: true, moved: results.length, strategy: flatten ? 'flatten' : strategy };
  } catch (error) {
    log.error('Error organizing folder:', error);
    return { success: false, error: String(error) };
  }
})

ipcMain.handle('convert-document:analyze', async (_, files: { filePath: string; outputPath?: string }[]) => {
  try {
    const validFiles: { filePath: string; outputPath: string; fileName: string; fileSize: number }[] = [];
    const errors: string[] = [];
    
    for (const f of files) {
      const filePath = f.filePath;
      const ext = filePath.toLowerCase().split('.').pop();
      
      if (ext !== 'pptx' && ext !== 'ppt') {
        errors.push(`${filePath}: Not a PowerPoint file`);
        continue;
      }
      
      if (!existsSync(filePath)) {
        errors.push(`${filePath}: File not found`);
        continue;
      }
      
      const stats = statSync(filePath);
      const fileName = filePath.split(/[\\/]/).pop() || 'unknown.pptx';
      const outputPath = f.outputPath || filePath.replace(/\.[^.]+$/, '.pdf');
      
      validFiles.push({
        filePath,
        outputPath,
        fileName,
        fileSize: stats.size
      });
    }
    
    const totalSize = validFiles.reduce((sum, f) => sum + f.fileSize, 0);
    
    return {
      type: 'convert_plan',
      files: validFiles,
      totalFiles: validFiles.length,
      totalSize,
      errors: errors.length > 0 ? errors : undefined
    };
  } catch (error) {
    log.error('Error analyzing documents for conversion:', error);
    return { type: 'convert_plan', error: String(error), files: [], totalFiles: 0 };
  }
})

ipcMain.handle('convert-document:execute', async (_, files: { inputPath: string; outputPath: string }[]) => {
  const results: { fileName: string; success: boolean; outputPath?: string; error?: string }[] = [];
  let successCount = 0;
  
  for (const f of files) {
    const { inputPath, outputPath } = f;
    const fileName = inputPath.split(/[\\/]/).pop() || 'unknown.pptx';
    
    try {
      const outputDir = dirname(outputPath);
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }
      
      const { convert } = await import('pptx-to-pdf');
      const pptxBuffer = readFileSync(inputPath);
      const pdfBuffer = await convert(pptxBuffer);
      writeFileSync(outputPath, pdfBuffer);
      log.info(`Converted ${inputPath} to ${outputPath}`);
      results.push({ fileName, success: true, outputPath });
      successCount++;
    } catch (error) {
      log.error(`Error converting ${inputPath}:`, error);
      results.push({ fileName, success: false, outputPath, error: String(error) });
    }
  }
  
  return {
    success: true,
    totalFiles: files.length,
    successCount,
    failedCount: files.length - successCount,
    results
  };
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
