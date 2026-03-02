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
    ask: (message: string) => ipcRenderer.invoke("ask", message),
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
