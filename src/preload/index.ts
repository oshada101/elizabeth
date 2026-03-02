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

export interface StreamChunk {
    type: "content";
    content: string;
}

export interface StreamTool {
    type: "tool_start" | "tool_end";
    tool: string;
}

export interface StreamDone {
    type: "done";
    content: string;
}

export interface StreamError {
    type: "error";
    error: string;
}

type StreamEvent = StreamChunk | StreamTool | StreamDone | StreamError;

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
    onAskStream: (callback: (event: StreamEvent) => void) => {
        const chunkHandler = (_: any, data: StreamChunk) => callback(data);
        const toolHandler = (_: any, data: StreamTool) => callback(data);
        const doneHandler = (_: any, data: StreamDone) => callback(data);
        const errorHandler = (_: any, data: StreamError) => callback(data);

        ipcRenderer.on("ask:chunk", chunkHandler);
        ipcRenderer.on("ask:tool", toolHandler);
        ipcRenderer.on("ask:done", doneHandler);
        ipcRenderer.on("ask:error", errorHandler);

        return () => {
            ipcRenderer.removeListener("ask:chunk", chunkHandler);
            ipcRenderer.removeListener("ask:tool", toolHandler);
            ipcRenderer.removeListener("ask:done", doneHandler);
            ipcRenderer.removeListener("ask:error", errorHandler);
        };
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
