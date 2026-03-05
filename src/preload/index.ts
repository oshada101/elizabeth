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
    ask: (message: string, sessionId: number) => ipcRenderer.invoke("ask", message, sessionId),
    loadPdfText: (pdfData: Uint8Array, filePath: string, sessionId: number): Promise<string | null> =>
        ipcRenderer.invoke("load-pdf-text", pdfData, filePath, sessionId),
    documents: {
        list: (): Promise<DocumentInfo[]> => ipcRenderer.invoke("documents:list"),
        switch: (hash: string): Promise<boolean> => ipcRenderer.invoke("documents:switch", hash),
        current: (): Promise<string | null> => ipcRenderer.invoke("documents:current"),
        delete: (hash: string): Promise<boolean> => ipcRenderer.invoke("documents:delete", hash),
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
