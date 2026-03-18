import { FileEntry, TreeEntry, Session, Message, DocumentInfo } from "../../preload/index";

interface FsApi {
    getHomeDir: () => Promise<string>;
    getDefaultDir: () => Promise<string>;
    readDir: (dirPath: string) => Promise<FileEntry[] | null>;
    getParentDir: (dirPath: string) => Promise<string | null>;
    exists: (filePath: string) => Promise<boolean>;
    listTree: (dirPath: string) => Promise<TreeEntry[]>;
    moveFile: (oldPath: string, newPath: string) => Promise<{ success: boolean; error?: string }>;
    createDirectory: (dirPath: string) => Promise<{ success: boolean; error?: string }>;
    delete: (targetPath: string) => Promise<{ success: boolean; error?: string }>;
    organizeFolder: (options: { targetPath: string; action: string; strategy?: string; flatten?: boolean }) => Promise<{ cancelled?: boolean; success?: boolean; moved?: number; strategy?: string; error?: string }>;
}

interface DocumentsApi {
    list: () => Promise<DocumentInfo[]>;
    switch: (hash: string) => Promise<boolean>;
    current: () => Promise<string | null>;
    delete: (hash: string) => Promise<boolean>;
}

interface ApiKeysApi {
    save: (data: any) => Promise<any>;
    list: () => Promise<any[]>;
    delete: (id: string) => Promise<boolean>;
    setDefault: (id: string) => Promise<boolean>;
    update: (id: string, data: any) => Promise<any>;
}

interface ConvertDocumentApi {
    analyze: (files: { filePath: string; outputPath?: string }[]) => Promise<{ type: string; files?: { filePath: string; outputPath: string; fileName: string; fileSize: number }[]; totalFiles?: number; totalSize?: number; errors?: string[]; error?: string }>;
    execute: (files: { inputPath: string; outputPath: string }[]) => Promise<{ success: boolean; totalFiles: number; successCount: number; failedCount: number; results: { fileName: string; success: boolean; outputPath?: string; error?: string }[] }>;
}

interface ElectronAPI {
    openFileDialog: () => Promise<string | null>;
    readFile: (filePath: string) => Promise<Buffer | null>;
    getSessions: () => Promise<Session[]>;
    createSession: (pdfPath: string) => Promise<number | null>;
    updateSession: (sessionId: number, pdfPath: string) => Promise<void>;
    getMessages: (sessionId: number) => Promise<Message[]>;
    addMessage: (sessionId: number, role: string, content: string) => Promise<number>;
    clearMessages: (sessionId: number) => Promise<void>;
    deleteSession: (sessionId: number) => Promise<boolean>;
    ask: (message: string, sessionId: number, currentPath: string) => Promise<any>;
    onAgentChunk: (callback: (chunk: string) => void) => () => void;
    onAgentTool: (callback: (toolCall: any) => void) => () => void;
    onEmbeddingProgress: (callback: (progress: number) => void) => () => void;
    embedDirectoryPdfs: (dirPath: string) => Promise<any>;
    onBatchEmbeddingFileStart: (callback: (data: any) => void) => () => void;
    onBatchEmbeddingFileProgress: (callback: (data: any) => void) => () => void;
    onBatchEmbeddingFileDone: (callback: (data: any) => void) => () => void;
    onBatchEmbeddingDone: (callback: (data: any) => void) => () => void;
    loadPdfText: (pdfData: Uint8Array, filePath: string, sessionId: number) => Promise<string | null>;
    documents: DocumentsApi;
    fs: FsApi;
    convertDocument: ConvertDocumentApi;
    windowMinimize: () => void;
    windowMaximize: () => void;
    windowClose: () => void;
    apiKeys: ApiKeysApi;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

export {};