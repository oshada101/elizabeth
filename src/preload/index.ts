import { contextBridge, ipcRenderer } from "electron";

export interface Session {
    id: number;
    pdf_path: string;
    created_at: string;
    updated_at: string;
}

export interface Message {
    id: number;
    session_id: number;
    role: string;
    content: string;
    timestamp: string;
}

export interface DocumentInfo {
    id: string;
    file_name: string;
    file_path: string;
    total_chunks: number;
    last_accessed: string;
}

export interface FileEntry {
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    modified: string;
}

export interface TreeEntry {
    name: string;
    path: string;
    isDirectory: boolean;
    children?: TreeEntry[];
    size?: number;
    modified?: string;
}

const api = {
    openFileDialog: (): Promise<string | null> =>
        ipcRenderer.invoke("open-file-dialog"),
    readFile: (filePath: string): Promise<Buffer | null> =>
        ipcRenderer.invoke("read-file", filePath),
    getSessions: (): Promise<Session[]> => ipcRenderer.invoke("get-sessions"),
    createSession: (pdfPath: string): Promise<number | null> =>
        ipcRenderer.invoke("create-session", pdfPath),
    updateSession: (sessionId: number, pdfPath: string): Promise<void> =>
        ipcRenderer.invoke("update-session", sessionId, pdfPath),
    getMessages: (sessionId: number): Promise<Message[]> =>
        ipcRenderer.invoke("get-messages", sessionId),
    addMessage: (
        sessionId: number,
        role: string,
        content: string,
    ): Promise<number> =>
        ipcRenderer.invoke("add-message", sessionId, role, content),
    clearMessages: (sessionId: number): Promise<void> =>
        ipcRenderer.invoke("clear-messages", sessionId),
    deleteSession: (sessionId: number): Promise<boolean> =>
        ipcRenderer.invoke("delete-session", sessionId),
    ask: (message: string, sessionId: number, currentPath: string) => ipcRenderer.invoke("ask", message, sessionId, currentPath),
    onAgentChunk: (callback: (chunk: string) => void) => {
        const handler = (_event: any, chunk: string) => callback(chunk);
        ipcRenderer.on('agent:chunk', handler);
        return () => ipcRenderer.removeListener('agent:chunk', handler);
    },
    onAgentTool: (callback: (toolCall: any) => void) => {
        const handler = (_event: any, toolCall: any) => callback(toolCall);
        ipcRenderer.on('agent:tool', handler);
        return () => ipcRenderer.removeListener('agent:tool', handler);
    },
    onEmbeddingProgress: (callback: (progress: number) => void) => {
        const handler = (_event: any, progress: number) => callback(progress);
        ipcRenderer.on('embedding:progress', handler);
        return () => ipcRenderer.removeListener('embedding:progress', handler);
    },
    embedDirectoryPdfs: (dirPath: string): Promise<any> =>
        ipcRenderer.invoke("embed-directory-pdfs", dirPath),
    onBatchEmbeddingFileStart: (callback: (data: any) => void) => {
        const handler = (_event: any, data: any) => callback(data);
        ipcRenderer.on('batch-embedding:file-start', handler);
        return () => ipcRenderer.removeListener('batch-embedding:file-start', handler);
    },
    onBatchEmbeddingFileProgress: (callback: (data: any) => void) => {
        const handler = (_event: any, data: any) => callback(data);
        ipcRenderer.on('batch-embedding:file-progress', handler);
        return () => ipcRenderer.removeListener('batch-embedding:file-progress', handler);
    },
    onBatchEmbeddingFileDone: (callback: (data: any) => void) => {
        const handler = (_event: any, data: any) => callback(data);
        ipcRenderer.on('batch-embedding:file-done', handler);
        return () => ipcRenderer.removeListener('batch-embedding:file-done', handler);
    },
    onBatchEmbeddingDone: (callback: (data: any) => void) => {
        const handler = (_event: any, data: any) => callback(data);
        ipcRenderer.on('batch-embedding:done', handler);
        return () => ipcRenderer.removeListener('batch-embedding:done', handler);
    },
    loadPdfText: (pdfData: Uint8Array, filePath: string, sessionId: number): Promise<string | null> =>
        ipcRenderer.invoke("load-pdf-text", pdfData, filePath, sessionId),
    documents: {
        list: (): Promise<DocumentInfo[]> => ipcRenderer.invoke("documents:list"),
        switch: (hash: string): Promise<boolean> => ipcRenderer.invoke("documents:switch", hash),
        current: (): Promise<string | null> => ipcRenderer.invoke("documents:current"),
        delete: (hash: string): Promise<boolean> => ipcRenderer.invoke("documents:delete", hash),
    },
    fs: {
        getHomeDir: (): Promise<string> => ipcRenderer.invoke("fs:get-home-dir"),
        getDefaultDir: (): Promise<string> => ipcRenderer.invoke("fs:get-default-dir"),
        readDir: (dirPath: string): Promise<FileEntry[] | null> => ipcRenderer.invoke("fs:read-dir", dirPath),
        getParentDir: (dirPath: string): Promise<string | null> => ipcRenderer.invoke("fs:get-parent-dir", dirPath),
        exists: (filePath: string): Promise<boolean> => ipcRenderer.invoke("fs:exists", filePath),
        listTree: (dirPath: string): Promise<TreeEntry[]> => ipcRenderer.invoke("fs:list-tree", dirPath),
        moveFile: (oldPath: string, newPath: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke("fs:move-file", oldPath, newPath),
        createDirectory: (dirPath: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke("fs:create-directory", dirPath),
        delete: (targetPath: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke("fs:delete", targetPath),
        organizeFolder: (options: { targetPath: string; action: string; strategy?: string }): Promise<{ cancelled?: boolean; success?: boolean; moved?: number; strategy?: string; error?: string }> => ipcRenderer.invoke("fs:organize-folder", options),
    },
    windowMinimize: () => ipcRenderer.invoke("window-minimize"),
    windowMaximize: () => ipcRenderer.invoke("window-maximize"),
    windowClose: () => ipcRenderer.invoke("window-close"),
    apiKeys: {
        save: (data: any) => ipcRenderer.invoke("api-keys:save", data),
        list: () => ipcRenderer.invoke("api-keys:list"),
        delete: (id: string) => ipcRenderer.invoke("api-keys:delete", id),
        setDefault: (id: string) => ipcRenderer.invoke("api-keys:set-default", id),
        update: (id: string, data: any) => ipcRenderer.invoke("api-keys:update", id, data),
    },
};

contextBridge.exposeInMainWorld("electronAPI", api);
