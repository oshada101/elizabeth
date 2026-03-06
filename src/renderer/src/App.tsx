import { useState, useEffect, useCallback } from "react";
import PDFViewer from "./components/PDFViewer";
import TOCPanel from "./components/TOCPanel";
import SettingsModal from "./components/SettingsModal";
import FileExplorer from "./components/FileExplorer";
import FileViewer from "./components/FileViewer";
import UnifiedPanel from "./components/UnifiedPanel";
import React from "react";
import * as pdfjsLib from "pdfjs-dist";

declare global {
    interface Window {
        electronAPI: {
            openFileDialog: () => Promise<string | null>;
            readFile: (filePath: string) => Promise<Buffer | null>;
            getSessions: () => Promise<Session[]>;
            createSession: (pdfPath: string) => Promise<number | null>;
            updateSession: (
                sessionId: number,
                pdfPath: string,
            ) => Promise<void>;
            getMessages: (sessionId: number) => Promise<Message[]>;
            addMessage: (
                sessionId: number,
                role: string,
                content: string,
            ) => Promise<number>;
            clearMessages: (sessionId: number) => Promise<void>;
            deleteSession: (sessionId: number) => Promise<boolean>;
            ask: (message: string, sessionId: number) => Promise<any>;
            onAgentChunk: (callback: (chunk: string) => void) => () => void;
            onAgentTool: (callback: (toolCall: any) => void) => () => void;
            onEmbeddingProgress: (callback: (progress: number) => void) => () => void;
            loadPdfText: (pdfData: Uint8Array, filePath: string, sessionId: number) => Promise<string | null>;
            documents: {
                list: () => Promise<Array<{ id: string, file_name: string, file_path: string, total_chunks: number, last_accessed: string }>>;
                switch: (hash: string) => Promise<boolean>;
                current: () => Promise<string | null>;
                delete: (hash: string) => Promise<boolean>;
            };
            fs: {
                getHomeDir: () => Promise<string>;
                getDefaultDir: () => Promise<string>;
                readDir: (dirPath: string) => Promise<Array<{ name: string, path: string, isDirectory: boolean, size: number, modified: string }>>;
                getParentDir: (dirPath: string) => Promise<string | null>;
                exists: (filePath: string) => Promise<boolean>;
            };
            windowMinimize: () => Promise<void>;
            windowMaximize: () => Promise<void>;
            windowClose: () => Promise<void>;
            apiKeys: {
                save: (data: { account: string, provider: string, label: string, isDefault: boolean, models: string[], apiKey: string, baseUrl?: string }) => Promise<string>;
                list: () => Promise<any[]>;
                delete: (id: string) => Promise<void>;
                setDefault: (id: string) => Promise<void>;
                update: (id: string, data: { account?: string, provider?: string, label?: string, isDefault?: boolean, models?: string[], apiKey?: string, baseUrl?: string }) => Promise<void>;
            };
        };
    }
}

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

interface DocumentInfo {
    id: string;
    file_name: string;
    file_path: string;
    total_chunks: number;
    last_accessed: string;
}

interface FileEntry {
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    modified: string;
}

function App() {
    const [currentPath, setCurrentPath] = useState<string | null>(null);
    const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
    const [pdfPath, setPdfPath] = useState<string | null>(null);
    const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
    const [pdfText, setPdfText] = useState<string | null>(null);
    const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
    const [fileName, setFileName] = useState<string | null>(null);
    const [sessionId, setSessionId] = useState<number | null>(null);
    const [selectedText, setSelectedText] = useState<string | null>(null);
    const [tocOpen, setTocOpen] = useState(false);
    const [chatOpen, setChatOpen] = useState(true);
    const [docsOpen, setDocsOpen] = useState(false);
    const [viewMode, setViewMode] = useState<"explorer" | "viewer">("explorer");
    const [currentPage, setCurrentPage] = useState(1);
    const [menuOpen, setMenuOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [documents, setDocuments] = useState<DocumentInfo[]>([]);
    const [currentDocId, setCurrentDocId] = useState<string | null>(null);
    const [isEmbedding, setIsEmbedding] = useState(false);
    const [embeddingProgress, setEmbeddingProgress] = useState(0);

    useEffect(() => {
        const initHomeDir = async () => {
            const defaultDir = await window.electronAPI.fs.getDefaultDir();
            console.log('Starting in directory:', defaultDir);
            setCurrentPath(defaultDir);
        };
        initHomeDir();
    }, []);

    useEffect(() => {
        const initSession = async () => {
            try {
                const sessions = await window.electronAPI.getSessions();
                if (sessions.length > 0) {
                    const lastSession = sessions[0];
                    setSessionId(lastSession.id);
                } else {
                    const newSessionId =
                        await window.electronAPI.createSession("");
                    setSessionId(newSessionId);
                }
            } catch (error) {
                console.error("Error initializing session:", error);
                const newSessionId = await window.electronAPI.createSession("");
                setSessionId(newSessionId);
            }
        };
        initSession();
    }, []);

    useEffect(() => {
        // Setup embedding progress listener
        const removeProgressListener = window.electronAPI.onEmbeddingProgress((progress: number) => {
            setEmbeddingProgress(Math.min(99, Math.max(0, progress)));
        });

        return () => removeProgressListener();
    }, []);

    // Load documents list on mount and when pdfData changes
    useEffect(() => {
        const loadDocuments = async () => {
            try {
                console.log('Loading documents list...');
                const docs = await window.electronAPI.documents.list();
                console.log('Documents loaded:', docs.length);
                setDocuments(docs);
                const current = await window.electronAPI.documents.current();
                console.log('Current document:', current);
                setCurrentDocId(current);
            } catch (error) {
                console.error('Error loading documents:', error);
            }
        };
        loadDocuments();
    }, []); // Load once on mount

    useEffect(() => {
        const handleClickOutside = () => setMenuOpen(false);
        if (menuOpen) {
            document.addEventListener("click", handleClickOutside);
            return () => document.removeEventListener("click", handleClickOutside);
        }
    }, [menuOpen]);

    const handleFileOpen = useCallback(async () => {
        const filePath = await window.electronAPI.openFileDialog();
        if (filePath) {
            const buffer = await window.electronAPI.readFile(filePath);
            if (buffer) {
                setPdfPath(filePath);
                setFileName(filePath.split(/[\\/]/).pop() || null);
                setPdfData(new Uint8Array(buffer));
                if (sessionId) {
                    await window.electronAPI.updateSession(sessionId, filePath);
                }
            }
        }
    }, [sessionId]);

    const handleFileDrop = useCallback(async (file: File) => {
        if (file.type === "application/pdf") {
            const arrayBuffer = await file.arrayBuffer();
            setPdfData(new Uint8Array(arrayBuffer));
            setPdfPath(file.name); // Use filename as path for drag-drop
            setFileName(file.name);
        }
    }, []);

    const handleSwitchDocument = useCallback(async (hash: string) => {
        try {
            const success = await window.electronAPI.documents.switch(hash);
            if (success) {
                setCurrentDocId(hash);
                const doc = documents.find(d => d.id === hash);
                if (doc && doc.file_path) {
                    const buffer = await window.electronAPI.readFile(doc.file_path);
                    if (buffer) {
                        setPdfData(new Uint8Array(buffer));
                        setPdfPath(doc.file_path);
                        setFileName(doc.file_name);
                    }
                }
            }
        } catch (error) {
            console.error('Error switching document:', error);
        }
    }, [documents]);

    const handleDeleteDocument = useCallback(async (e: React.MouseEvent, hash: string) => {
        e.stopPropagation();
        try {
            const success = await window.electronAPI.documents.delete(hash);
            if (success) {
                setDocuments(prev => prev.filter(d => d.id !== hash));
                if (currentDocId === hash) {
                    setCurrentDocId(null);
                    setPdfData(null);
                    setPdfPath('');
                    setFileName('');
                }
            }
        } catch (error) {
            console.error('Error deleting document:', error);
        }
    }, [currentDocId]);

    const handleFileExplorerNavigate = useCallback((path: string) => {
        setCurrentPath(path);
    }, []);

    const handleNewSession = useCallback(async () => {
        try {
            const newId = await window.electronAPI.createSession("");
            if (newId) {
                setSessionId(newId as number);
                setSelectedText(null);
            }
        } catch (e) {
            console.error('Failed to create new session', e);
        }
    }, []);

    const handleSessionChange = useCallback(async (newSessionId: number) => {
        setSessionId(newSessionId);
    }, []);

    const handleDeleteSession = useCallback(async (targetSessionId: number) => {
        try {
            await window.electronAPI.deleteSession(targetSessionId);
            if (sessionId === targetSessionId) {
                // Create a new session if we deleted the current one
                const newId = await window.electronAPI.createSession("");
                if (newId) {
                    setSessionId(newId as number);
                }
            }
        } catch (e) {
            console.error('Failed to delete session', e);
        }
    }, [sessionId]);

    const handleFileClick = useCallback((file: FileEntry) => {
        if (!file.isDirectory) {
            setSelectedFile(file);
            setViewMode("viewer");
            if (file.name.endsWith('.pdf')) {
                setIsEmbedding(true);
                setEmbeddingProgress(10);
                window.electronAPI.readFile(file.path).then(buffer => {
                    if (buffer) {
                        setPdfPath(file.path);
                        setFileName(file.name);
                        setPdfData(new Uint8Array(buffer));
                        setEmbeddingProgress(30);
                        // Load PDF text for embedding
                        if (sessionId) {
                            window.electronAPI.loadPdfText(new Uint8Array(buffer), file.path, sessionId).then((hash) => {
                                if (hash) {
                                    setEmbeddingProgress(100);
                                    setTimeout(() => setIsEmbedding(false), 500);
                                } else {
                                    setEmbeddingProgress(100);
                                    setTimeout(() => setIsEmbedding(false), 500);
                                }
                            }).catch(() => {
                                setEmbeddingProgress(100);
                                setTimeout(() => setIsEmbedding(false), 500);
                            });
                        } else {
                            setEmbeddingProgress(100);
                            setTimeout(() => setIsEmbedding(false), 500);
                        }
                    } else {
                        setIsEmbedding(false);
                    }
                }).catch(() => {
                    setIsEmbedding(false);
                });
            }
        }
    }, [sessionId]);

    const handleCloseFileViewer = useCallback(() => {
        setSelectedFile(null);
    }, []);

    const handleTextSelect = useCallback((text: string) => {
        setSelectedText(text);
    }, []);

    const handleClearSelection = useCallback(() => {
        setSelectedText(null);
        window.getSelection()?.removeAllRanges();
    }, []);

    const handleNavigate = useCallback((pageNum: number) => {
        setCurrentPage(pageNum);
    }, []);

    const handlePageChange = useCallback((page: number) => {
        setCurrentPage(page);
    }, []);

    const handlePdfLoad = useCallback((pdfDoc: pdfjsLib.PDFDocumentProxy) => {
        setPdf(pdfDoc);
    }, []);

    useEffect(() => {
        if (pdfData && sessionId && pdfPath) {
            window.electronAPI.loadPdfText(pdfData, pdfPath, sessionId).then((hash) => {
                if (hash) {
                    console.log('PDF processed, document hash:', hash.substring(0, 8) + '...');
                }
            });
        }
    }, [pdfData, sessionId, pdfPath]);

    const menuItems = [
        {
            label: "New Session",
            icon: (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" />
                </svg>
            ),
            action: async () => {
                try {
                    const newId = await window.electronAPI.createSession("");
                    if (newId) {
                        setSessionId(newId as number);
                        setSelectedText(null);
                    }
                } catch (e) {
                    console.error('Failed to create new session', e);
                }
            },
        },
        {
            label: "Settings",
            icon: (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                </svg>
            ),
            action: () => setSettingsOpen(true),
        },
        {
            label: "Quit",
            icon: (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 14a6 6 0 110-12 6 6 0 010 12zm-1-5a1 1 0 011-1h2a1 1 0 110 2h-2a1 1 0 01-1-1z" clipRule="evenodd" />
                </svg>
            ),
            action: () => window.electronAPI.windowClose(),
        }
    ];

    return (
        <div className="h-screen flex flex-col">
            <header className="h-10 relative flex justify-between items-center glass-panel shadow-glass px-4 py-1 rounded-t-2xl text-white overflow-visible z-50" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
                <div className="flex items-center gap-3">
                    <div className="relative" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setMenuOpen(!menuOpen);
                            }}
                            className="group p-2.5 rounded-xl hover:bg-white/10  hover:border-purple-500/30 transition-all duration-300 hover:shadow-[0_0_20px_rgba(168,85,247,0.2)]"
                        >
                            <div className="relative w-5 h-5">
                                <span className={`absolute left-0 top-1/2 -translate-y-1/2 h-0.5 w-5 bg-purple-200 group-hover:bg-purple-100 rounded-full transition-all duration-300 ${menuOpen ? 'rotate-45 top-1/2' : '-translate-y-2'}`} />
                                <span className={`absolute left-0 top-1/2 -translate-y-1/2 h-0.5 w-5 bg-purple-200 group-hover:bg-purple-100 rounded-full transition-all duration-300 ${menuOpen ? 'opacity-0' : 'opacity-100'}`} />
                                <span className={`absolute left-0 top-1/2 -translate-y-1/2 h-0.5 w-5 bg-purple-200 group-hover:bg-purple-100 rounded-full transition-all duration-300 ${menuOpen ? '-rotate-45 top-1/2' : 'translate-y-2'}`} />
                            </div>
                        </button>
                        <div
                            className={`absolute top-full left-0 mt-2 w-48 transition-all duration-300 ease-out ${menuOpen ? 'opacity-100 translate-y-0 visible' : 'opacity-0 translate-y-2 invisible'
                                }`}
                        >
                            <div className="bg-gradient-to-br from-primary-800 to-primary-900 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 overflow-hidden">
                                <div className="p-1">
                                    {menuItems.map((item, index) => (
                                        <div key={index}>
                                            <button
                                                onClick={() => {
                                                    item.action();
                                                    setMenuOpen(false);
                                                }}
                                                className="w-full px-4 py-2.5 text-left text-sm text-purple-200 hover:text-white rounded-xl hover:bg-white/10 transition-all duration-200 flex items-center gap-3 group"
                                            >
                                                <span className="text-purple-400 group-hover:text-purple-300 transition-colors">
                                                    {item.icon}
                                                </span>
                                                {item.label}
                                            </button>
                                            {index < menuItems.length - 1 && <hr className="border-white/10 my-1" />}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">

                        <h1 className="font-semibold text-2xl tracking-wide bg-gradient-to-r from-purple-100 via-indigo-200 to-purple-200 bg-clip-text text-transparent">
                            Elizabeth
                        </h1>
                    </div>
                </div>

                <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                    <button
                        onClick={async () => window.electronAPI.windowMinimize()}
                        className="group p-2 rounded-xl hover:bg-white/10 text-purple-300 hover:text-white transition-all duration-200 hover:shadow-[0_0_15px_rgba(168,85,247,0.2)]"
                        title="Minimize"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                        </svg>
                    </button>
                    <button
                        onClick={() => window.electronAPI.windowMaximize()}
                        className="group p-2 rounded-xl hover:bg-white/10 text-purple-300 hover:text-white transition-all duration-200 hover:shadow-[0_0_15px_rgba(168,85,247,0.2)]"
                        title="Maximize"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5 4a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V5a1 1 0 00-1-1H5zm0 2h10v8H5V6z" clipRule="evenodd" />
                        </svg>
                    </button>
                    <button
                        onClick={() => window.electronAPI.windowClose()}
                        className="group p-2 rounded-xl hover:bg-red-500/80 text-purple-300 hover:text-white transition-all duration-200"
                        title="Close"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>
            </header>
            <div className="relative flex h-full bg-primary-950 p-3 gap-3 z-0 min-h-0">

                {/* Main Content - Explorer or Viewer */}
                {viewMode === "explorer" ? (
                    <>
                        {/* File Explorer - 60% */}
                        <div className="flex-[3] h-full rounded-2xl overflow-hidden glass-panel shadow-glass">
                            <FileExplorer
                                currentPath={currentPath || ""}
                                onNavigate={handleFileExplorerNavigate}
                                onFileClick={handleFileClick}
                            />
                        </div>
                        {/* Unified Panel - 40% */}
                        <div className="flex-[2] h-full rounded-2xl overflow-hidden glass-panel shadow-glass">
                            <UnifiedPanel
                                currentPath={currentPath || ""}
                                onNavigate={handleFileExplorerNavigate}
                                onFileSelect={(file) => {
                                    handleFileClick(file);
                                    setSelectedFile(file);
                                    setViewMode("viewer");
                                }}
                                mode="explorer"
                                pdfPath={pdfPath}
                                sessionId={sessionId}
                                selectedText={selectedText}
                                onClearSelection={handleClearSelection}
                                onNewSession={handleNewSession}
                                onSessionChange={handleSessionChange}
                                onDeleteSession={handleDeleteSession}
                            />
                        </div>
                    </>
                ) : (
                    <>
                        {/* TOC Panel */}
                        <div
                            className={`h-full rounded-2xl overflow-hidden glass-panel shadow-glass transition-all duration-300 ${tocOpen ? "w-72 opacity-100" : "w-0 opacity-0 overflow-hidden"}`}
                        >
                            {tocOpen && pdf && (
                                <TOCPanel pdf={pdf} onNavigate={handleNavigate} currentPage={currentPage} />
                            )}
                        </div>

                        {/* PDF Viewer */}
                        <div className="flex-1 h-full rounded-2xl overflow-hidden glass-panel shadow-glass">
                            <div className="h-full flex flex-col">
                                {/* Combined Header */}
                                <div className="p-3 border-b border-white/10">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => {
                                                    setViewMode("explorer");
                                                    setSelectedFile(null);
                                                }}
                                                className="p-2 rounded-lg hover:bg-white/10 text-purple-300 hover:text-white transition-colors"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                                </svg>
                                            </button>
                                            <span className="text-white font-medium">{selectedFile?.name}</span>
                                        </div>
                                        <button
                                            onClick={() => {
                                                setViewMode("explorer");
                                                setSelectedFile(null);
                                            }}
                                            className="p-2 rounded-lg hover:bg-white/10 text-purple-300 hover:text-white transition-colors"
                                        >
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                    {/* Progress Bar */}
                                    {isEmbedding && (
                                        <div className="mt-2">
                                            <div className="flex items-center justify-between text-xs text-purple-300 mb-1">
                                                <span>Embedding document...</span>
                                                <span>{embeddingProgress}%</span>
                                            </div>
                                            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-purple-500 rounded-full transition-all duration-300"
                                                    style={{ width: `${embeddingProgress}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 overflow-hidden">
                                    <PDFViewer
                                        pdfData={pdfData}
                                        onTextSelect={handleTextSelect}
                                        fileName={fileName || undefined}
                                        navigateToPage={currentPage}
                                        onPageChange={handlePageChange}
                                        onPdfLoad={handlePdfLoad}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Unified Panel */}
                        <div className="w-[500px] h-full rounded-2xl overflow-hidden glass-panel shadow-glass">
                            <UnifiedPanel
                                currentPath={currentPath || ""}
                                onNavigate={handleFileExplorerNavigate}
                                onFileSelect={(file) => {
                                    handleFileClick(file);
                                    setSelectedFile(file);
                                }}
                                mode="viewer"
                                pdfPath={pdfPath}
                                sessionId={sessionId}
                                selectedText={selectedText}
                                onClearSelection={handleClearSelection}
                                onNewSession={handleNewSession}
                                onSessionChange={handleSessionChange}
                                onDeleteSession={handleDeleteSession}
                                onBack={() => {
                                    setViewMode("explorer");
                                    setSelectedFile(null);
                                }}
                                isEmbedding={isEmbedding}
                                embeddingProgress={embeddingProgress}
                            />
                        </div>
                    </>
                )}

                {/* Documents Panel - Left Side */}
                <div
                    className={`h-full rounded-2xl overflow-hidden glass-panel shadow-glass transition-all duration-300 ease-in-out ${docsOpen ? "w-80 opacity-100" : "w-0 opacity-0 p-0"
                        }`}
                >
                    {docsOpen && (
                        <div className="h-full flex flex-col">
                            <div className="p-4 border-b border-white/10">
                                <h3 className="text-lg font-semibold text-purple-200">Documents</h3>
                                <p className="text-xs text-purple-400/70 mt-1">
                                    {documents.length} document{documents.length !== 1 ? 's' : ''} embedded
                                </p>
                            </div>
                            <div className="flex-1 overflow-y-auto p-2 space-y-2">
                                {documents.map((doc) => (
                                    <button
                                        key={doc.id}
                                        onClick={() => handleSwitchDocument(doc.id)}
                                        className={`w-full text-left p-3 rounded-xl transition-all duration-200 ${currentDocId === doc.id
                                            ? "bg-purple-500/30 border border-purple-500/30"
                                            : "bg-white/5 hover:bg-white/10 border border-transparent"
                                            }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-purple-400 mt-0.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                                            </svg>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between">
                                                    <p className="text-sm font-medium text-purple-200 truncate">
                                                        {doc.file_name}
                                                    </p>
                                                    <button
                                                        onClick={(e) => handleDeleteDocument(e, doc.id)}
                                                        className="p-1 rounded-lg hover:bg-red-500/30 text-purple-400 hover:text-red-400 transition-colors"
                                                        title="Remove document"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                                        </svg>
                                                    </button>
                                                </div>
                                                <p className="text-xs text-purple-400/60 mt-1">
                                                    {doc.total_chunks} chunks • {new Date(doc.last_accessed).toLocaleDateString()}
                                                </p>
                                                {currentDocId === doc.id && (
                                                    <span className="inline-block mt-2 text-xs bg-purple-500/30 text-purple-300 px-2 py-0.5 rounded-full">
                                                        Current
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </button>
                                ))}
                                {documents.length === 0 && (
                                    <div className="text-center py-8 text-purple-400/50">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-3 opacity-50" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                                        </svg>
                                        <p className="text-sm">No documents yet</p>
                                        <p className="text-xs mt-1">Open a PDF to get started</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Floating Toolbar */}
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-primary-900 rounded-full px-2 py-2 flex items-center gap-2 shadow-glass">
                    <button
                        onClick={() => setDocsOpen(!docsOpen)}
                        className={`p-2 rounded-full transition-all duration-200 ${docsOpen
                            ? "bg-purple-500/30 text-purple-200"
                            : "bg-white/5 text-primary-300 hover:bg-white/10"
                            }`}
                        title="Documents Library"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M9 2a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V6.414A2 2 0 0015.414 5L14 3.586A2 2 0 0012.586 3H9z" />
                            <path d="M3 8a2 2 0 012-2v8a2 2 0 01-2 2H1a1 1 0 011-1V9a1 1 0 01-1-1h1z" />
                        </svg>
                    </button>
                    <div className="w-px h-5 bg-white/10" />
                    <button
                        onClick={() => setTocOpen(!tocOpen)}
                        className={`p-2 rounded-full transition-all duration-200 ${tocOpen
                            ? "bg-purple-500/30 text-purple-200"
                            : "bg-white/5 text-primary-300 hover:bg-white/10"
                            }`}
                        title="Toggle Table of Contents"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-5 w-5"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                        >
                            <path d="M2 4a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1H3a1 1 0 01-1-1V4zM4 8a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V8zM2 14a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1H3a1 1 0 01-1-1v-2zM8 12a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H9a1 1 0 01-1-1v-2z" />
                        </svg>
                    </button>
                    <div className="w-px h-5 bg-white/10" />
                    <button
                        onClick={() => setChatOpen(!chatOpen)}
                        className={`p-2 rounded-full transition-all duration-200 ${chatOpen
                            ? "bg-purple-500/30 text-purple-200"
                            : "bg-white/5 text-primary-300 hover:bg-white/10"
                            }`}
                        title="Toggle Chat"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-5 w-5"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                        >
                            <path
                                fillRule="evenodd"
                                d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z"
                                clipRule="evenodd"
                            />
                        </svg>
                    </button>
                </div>
            </div>

            <SettingsModal
                isOpen={settingsOpen}
                onClose={() => setSettingsOpen(false)}
            />
        </div>
    );
}

export default App;
