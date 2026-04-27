import { useState, useEffect, useCallback, useMemo } from "react";
import PDFViewer from "./components/PDFViewer";
import TOCPanel from "./components/TOCPanel";
import SettingsModal from "./components/SettingsModal";
import FileExplorer from "./components/FileExplorer";
import UnifiedPanel from "./components/UnifiedPanel";
import LoadingScreen from "./components/LoadingScreen";
import React from "react";
import * as pdfjsLib from "pdfjs-dist";


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

interface TabState {
    id: string;
    viewMode: "explorer" | "viewer";
    currentPath: string;
    selectedFile: FileEntry | null;
    pdfPath: string | null;
    pdfData: Uint8Array | null;
    fileName: string | null;
    currentPage: number;
    pdf: pdfjsLib.PDFDocumentProxy | null;
    isEmbedding: boolean;
    embeddingProgress: number;
}

function makeTab(currentPath: string): TabState {
    return {
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        viewMode: "explorer",
        currentPath,
        selectedFile: null,
        pdfPath: null,
        pdfData: null,
        fileName: null,
        currentPage: 1,
        pdf: null,
        isEmbedding: false,
        embeddingProgress: 0,
    };
}

function getTabLabel(tab: TabState): string {
    if (tab.viewMode === "viewer" && tab.fileName) return tab.fileName;
    if (tab.currentPath) {
        const parts = tab.currentPath.replace(/\\/g, "/").split("/").filter(Boolean);
        return parts[parts.length - 1] || "Home";
    }
    return "New Tab";
}

const initialTab = makeTab("");

function App() {
    const [initsDone, setInitsDone] = useState(0);
    const [minTimeDone, setMinTimeDone] = useState(false);
    const [defaultDir, setDefaultDir] = useState("");
    const [tabs, setTabs] = useState<TabState[]>([initialTab]);
    const [activeTabId, setActiveTabId] = useState<string>(initialTab.id);
    const [folderRefreshKey, setFolderRefreshKey] = useState(0);
    const [sessionId, setSessionId] = useState<number | null>(null);
    const [selectedText, setSelectedText] = useState<string | null>(null);
    const [tocOpen, setTocOpen] = useState(false);
    const [chatOpen, setChatOpen] = useState(true);
    const [docsOpen, setDocsOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [documents, setDocuments] = useState<DocumentInfo[]>([]);
    const [currentDocId, setCurrentDocId] = useState<string | null>(null);
    const [batchEmbedding, setBatchEmbedding] = useState(false);
    const [batchProgress, setBatchProgress] = useState<{
        fileName: string;
        fileIndex: number;
        totalFiles: number;
        fileProgress: number;
    } | null>(null);

    const activeTab = useMemo(
        () => tabs.find((t) => t.id === activeTabId) ?? tabs[0],
        [tabs, activeTabId]
    );

    const updateActiveTab = useCallback(
        (partial: Partial<TabState>) => {
            setTabs((prev) =>
                prev.map((t) => (t.id === activeTabId ? { ...t, ...partial } : t))
            );
        },
        [activeTabId]
    );

    const updateTab = useCallback(
        (tabId: string, partial: Partial<TabState>) => {
            setTabs((prev) =>
                prev.map((t) => (t.id === tabId ? { ...t, ...partial } : t))
            );
        },
        []
    );

    useEffect(() => {
        const t = setTimeout(() => setMinTimeDone(true), 600);
        return () => clearTimeout(t);
    }, []);

    useEffect(() => {
        window.electronAPI.fs.getDefaultDir().then((dir: string) => {
            setDefaultDir(dir);
            setTabs((prev) =>
                prev.map((t) => (t.id === initialTab.id ? { ...t, currentPath: dir } : t))
            );
            setInitsDone((n) => n + 1);
        });
    }, []);

    useEffect(() => {
        const init = async () => {
            try {
                const sessions = await window.electronAPI.getSessions();
                if (sessions.length > 0) {
                    setSessionId(sessions[0].id);
                    setInitsDone((n) => n + 1);
                } else {
                    const newId = await window.electronAPI.createSession("");
                    setSessionId(newId);
                    setInitsDone((n) => n + 1);
                }
            } catch {
                const newId = await window.electronAPI.createSession("");
                setSessionId(newId);
                setInitsDone((n) => n + 1);
            }
        };
        init();
    }, []);

    useEffect(() => {
        const remove = window.electronAPI.onEmbeddingProgress((progress: number) => {
            updateActiveTab({ embeddingProgress: Math.min(99, Math.max(0, progress)) });
        });
        return () => remove();
    }, [updateActiveTab]);

    useEffect(() => {
        const unsubs = [
            window.electronAPI.onBatchEmbeddingFileStart((data) => {
                setBatchProgress({ fileName: data.fileName, fileIndex: data.fileIndex, totalFiles: data.totalFiles, fileProgress: 0 });
            }),
            window.electronAPI.onBatchEmbeddingFileProgress((data) => {
                setBatchProgress((prev) =>
                    prev ? { ...prev, fileProgress: data.progress, fileIndex: data.fileIndex, totalFiles: data.totalFiles, fileName: data.fileName } : null
                );
            }),
            window.electronAPI.onBatchEmbeddingFileDone(() => loadDocuments()),
            window.electronAPI.onBatchEmbeddingDone(() => {
                setBatchEmbedding(false);
                setBatchProgress(null);
            }),
        ];
        return () => unsubs.forEach((u) => u());
    }, []);

    const loadDocuments = async () => {
        try {
            const docs = await window.electronAPI.documents.list();
            setDocuments(docs);
            const current = await window.electronAPI.documents.current();
            setCurrentDocId(current);
            setInitsDone((n) => n + 1);
        } catch (e) {
            console.error("Failed to load documents:", e);
            setInitsDone((n) => n + 1);
        }
    };

    useEffect(() => { loadDocuments(); }, []);

    useEffect(() => {
        const handler = () => setMenuOpen(false);
        if (menuOpen) {
            document.addEventListener("click", handler);
            return () => document.removeEventListener("click", handler);
        }
    }, [menuOpen]);

    useEffect(() => {
        if (activeTab.pdfData && sessionId && activeTab.pdfPath) {
            window.electronAPI.loadPdfText(activeTab.pdfData.slice(), activeTab.pdfPath, sessionId).then((hash) => {
                if (hash) console.log("PDF processed:", hash.substring(0, 8) + "...");
            });
        }
    }, [activeTab.pdfData, activeTab.pdfPath, sessionId]);

    const handleNewTab = useCallback(() => {
        if (tabs.length >= 10) return;
        const tab = makeTab(defaultDir);
        setTabs((prev) => [...prev, tab]);
        setActiveTabId(tab.id);
    }, [tabs.length, defaultDir]);

    const handleCloseTab = useCallback(
        (tabId: string, e: React.MouseEvent) => {
            e.stopPropagation();
            if (tabs.length === 1) return;
            const idx = tabs.findIndex((t) => t.id === tabId);
            const newTabs = tabs.filter((t) => t.id !== tabId);
            if (activeTabId === tabId) {
                setActiveTabId(newTabs[Math.min(idx, newTabs.length - 1)].id);
            }
            setTabs(newTabs);
        },
        [tabs, activeTabId]
    );

    const handleFileOpen = useCallback(async () => {
        const filePath = await window.electronAPI.openFileDialog();
        if (filePath) {
            const buffer = await window.electronAPI.readFile(filePath);
            if (buffer) {
                const name = filePath.split(/[\\/]/).pop() || null;
                updateActiveTab({ pdfPath: filePath, fileName: name, pdfData: new Uint8Array(buffer) });
                if (sessionId) await window.electronAPI.updateSession(sessionId, filePath);
            }
        }
    }, [sessionId, updateActiveTab]);

    const handleFileDrop = useCallback(async (file: File) => {
        if (file.type === "application/pdf") {
            const buf = await file.arrayBuffer();
            updateActiveTab({ pdfData: new Uint8Array(buf), pdfPath: file.name, fileName: file.name });
        }
    }, [updateActiveTab]);

    const handleSwitchDocument = useCallback(async (hash: string) => {
        try {
            const success = await window.electronAPI.documents.switch(hash);
            if (success) {
                setCurrentDocId(hash);
                const doc = documents.find((d) => d.id === hash);
                if (doc?.file_path) {
                    const buffer = await window.electronAPI.readFile(doc.file_path);
                    if (buffer) {
                        updateActiveTab({ pdfData: new Uint8Array(buffer), pdfPath: doc.file_path, fileName: doc.file_name });
                    }
                }
            }
        } catch (e) {
            console.error("Error switching document:", e);
        }
    }, [documents, updateActiveTab]);

    const handleDeleteDocument = useCallback(async (e: React.MouseEvent, hash: string) => {
        e.stopPropagation();
        try {
            const success = await window.electronAPI.documents.delete(hash);
            if (success) {
                setDocuments((prev) => prev.filter((d) => d.id !== hash));
                if (currentDocId === hash) {
                    setCurrentDocId(null);
                    updateActiveTab({ pdfData: null, pdfPath: null, fileName: null });
                }
            }
        } catch (e) {
            console.error("Error deleting document:", e);
        }
    }, [currentDocId, updateActiveTab]);

    const handleEmbedAll = useCallback(async () => {
        if (!activeTab.currentPath || batchEmbedding) return;
        setBatchEmbedding(true);
        try {
            await window.electronAPI.embedDirectoryPdfs(activeTab.currentPath);
        } catch (e) {
            console.error("Failed to start batch embedding:", e);
            setBatchEmbedding(false);
            setBatchProgress(null);
        }
    }, [activeTab.currentPath, batchEmbedding]);

    const handleNewSession = useCallback(async () => {
        try {
            const newId = await window.electronAPI.createSession("");
            if (newId) { setSessionId(newId as number); setSelectedText(null); }
        } catch (e) {
            console.error("Failed to create session:", e);
        }
    }, []);

    const handleSessionChange = useCallback((newSessionId: number) => {
        setSessionId(newSessionId);
    }, []);

    const handleDeleteSession = useCallback(async (targetSessionId: number) => {
        try {
            await window.electronAPI.deleteSession(targetSessionId);
            if (sessionId === targetSessionId) {
                const newId = await window.electronAPI.createSession("");
                if (newId) setSessionId(newId as number);
            }
        } catch (e) {
            console.error("Failed to delete session:", e);
        }
    }, [sessionId]);

    const handleFileClick = useCallback((file: FileEntry) => {
        if (file.isDirectory) return;
        updateActiveTab({ selectedFile: file, viewMode: "viewer" });
        if (file.name.endsWith(".pdf")) {
            updateActiveTab({ isEmbedding: true, embeddingProgress: 10 });
            window.electronAPI.readFile(file.path).then((buffer) => {
                if (buffer) {
                    const uint8 = new Uint8Array(buffer);
                    updateActiveTab({ pdfPath: file.path, fileName: file.name, pdfData: uint8, embeddingProgress: 30 });
                    if (sessionId) {
                        window.electronAPI.loadPdfText(uint8.slice(), file.path, sessionId)
                            .then(() => { updateActiveTab({ embeddingProgress: 100 }); setTimeout(() => updateActiveTab({ isEmbedding: false }), 500); })
                            .catch(() => { updateActiveTab({ embeddingProgress: 100 }); setTimeout(() => updateActiveTab({ isEmbedding: false }), 500); });
                    } else {
                        updateActiveTab({ embeddingProgress: 100 });
                        setTimeout(() => updateActiveTab({ isEmbedding: false }), 500);
                    }
                } else {
                    updateActiveTab({ isEmbedding: false });
                }
            }).catch(() => updateActiveTab({ isEmbedding: false }));
        }
    }, [sessionId, updateActiveTab]);

    const handleOpenInNewTab = useCallback((filePath: string, fileName: string) => {
        if (tabs.length >= 10) return;
        const tab = makeTab(filePath.substring(0, filePath.lastIndexOf("/")) || defaultDir);
        const file: FileEntry = { name: fileName, path: filePath, isDirectory: false, size: 0, modified: "" };
        const newTab: TabState = { ...tab, selectedFile: file, viewMode: "viewer", fileName };
        setTabs((prev) => [...prev, newTab]);
        setActiveTabId(newTab.id);
        if (fileName.endsWith(".pdf")) {
            window.electronAPI.readFile(filePath).then((buffer) => {
                if (buffer) {
                    const uint8 = new Uint8Array(buffer);
                    setTabs((prev) => prev.map((t) => t.id === newTab.id ? { ...t, pdfPath: filePath, pdfData: uint8, isEmbedding: true, embeddingProgress: 30 } : t));
                    if (sessionId) {
                        window.electronAPI.loadPdfText(uint8.slice(), filePath, sessionId)
                            .then(() => { setTabs((prev) => prev.map((t) => t.id === newTab.id ? { ...t, embeddingProgress: 100 } : t)); setTimeout(() => setTabs((prev) => prev.map((t) => t.id === newTab.id ? { ...t, isEmbedding: false } : t)), 500); })
                            .catch(() => { setTabs((prev) => prev.map((t) => t.id === newTab.id ? { ...t, embeddingProgress: 100 } : t)); setTimeout(() => setTabs((prev) => prev.map((t) => t.id === newTab.id ? { ...t, isEmbedding: false } : t)), 500); });
                    } else {
                        setTabs((prev) => prev.map((t) => t.id === newTab.id ? { ...t, embeddingProgress: 100 } : t));
                        setTimeout(() => setTabs((prev) => prev.map((t) => t.id === newTab.id ? { ...t, isEmbedding: false } : t)), 500);
                    }
                }
            }).catch(() => setTabs((prev) => prev.map((t) => t.id === newTab.id ? { ...t, isEmbedding: false } : t)));
        }
    }, [tabs.length, defaultDir, sessionId]);

    const handleTextSelect = useCallback((text: string) => setSelectedText(text), []);
    const handleClearSelection = useCallback(() => { setSelectedText(null); window.getSelection()?.removeAllRanges(); }, []);
    const handleNavigate = useCallback((pageNum: number) => updateActiveTab({ currentPage: pageNum }), [updateActiveTab]);
    const handlePageChange = useCallback((page: number) => updateActiveTab({ currentPage: page }), [updateActiveTab]);
    const handlePdfLoad = useCallback((pdfDoc: pdfjsLib.PDFDocumentProxy) => updateActiveTab({ pdf: pdfDoc }), [updateActiveTab]);
    const handleFileExplorerNavigate = useCallback((path: string) => updateActiveTab({ currentPath: path }), [updateActiveTab]);

    const menuItems = [
        {
            label: "New Session",
            icon: (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" />
                </svg>
            ),
            action: handleNewSession,
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
        },
    ];

    const appReady = initsDone >= 3 && minTimeDone;

    if (!appReady) {
        return <LoadingScreen progress={(initsDone / 3) * 100} />;
    }

    return (
        <div className="h-screen flex flex-col">
            <header
                className="h-10 relative flex items-center glass-panel shadow-glass px-2 py-1 rounded-t-2xl text-white overflow-visible z-50"
                style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
            >
                {/* Left: menu + logo */}
                <div className="flex items-center gap-2 flex-shrink-0" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
                    <div className="relative">
                        <button
                            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
                            className="group p-2 rounded-xl hover:bg-white/10 transition-all duration-300"
                        >
                            <div className="relative w-5 h-5">
                                <span className={`absolute left-0 top-1/2 -translate-y-1/2 h-0.5 w-5 bg-purple-200 group-hover:bg-purple-100 rounded-full transition-all duration-300 ${menuOpen ? "rotate-45 top-1/2" : "-translate-y-2"}`} />
                                <span className={`absolute left-0 top-1/2 -translate-y-1/2 h-0.5 w-5 bg-purple-200 group-hover:bg-purple-100 rounded-full transition-all duration-300 ${menuOpen ? "opacity-0" : "opacity-100"}`} />
                                <span className={`absolute left-0 top-1/2 -translate-y-1/2 h-0.5 w-5 bg-purple-200 group-hover:bg-purple-100 rounded-full transition-all duration-300 ${menuOpen ? "-rotate-45 top-1/2" : "translate-y-2"}`} />
                            </div>
                        </button>
                        <div className={`absolute top-full left-0 mt-2 w-48 transition-all duration-300 ease-out ${menuOpen ? "opacity-100 translate-y-0 visible" : "opacity-0 translate-y-2 invisible"}`}>
                            <div className="bg-gradient-to-br from-primary-800 to-primary-900 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 overflow-hidden">
                                <div className="p-1">
                                    {menuItems.map((item, index) => (
                                        <div key={index}>
                                            <button
                                                onClick={() => { item.action(); setMenuOpen(false); }}
                                                className="w-full px-4 py-2.5 text-left text-sm text-purple-200 hover:text-white rounded-xl hover:bg-white/10 transition-all duration-200 flex items-center gap-3 group"
                                            >
                                                <span className="text-purple-400 group-hover:text-purple-300 transition-colors">{item.icon}</span>
                                                {item.label}
                                            </button>
                                            {index < menuItems.length - 1 && <hr className="border-white/10 my-1" />}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                    <h1 className="font-semibold text-xl tracking-wide bg-gradient-to-r from-purple-100 via-indigo-200 to-purple-200 bg-clip-text text-transparent pr-2">
                        Elizabeth
                    </h1>
                </div>

                {/* Tab bar */}
                <div
                    className="flex-1 flex items-center gap-1 overflow-x-auto min-w-0 px-1"
                    style={{ WebkitAppRegion: "no-drag", scrollbarWidth: "none" } as React.CSSProperties}
                >
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTabId(tab.id)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium max-w-[140px] min-w-[60px] flex-shrink-0 transition-all duration-200 group/tab ${
                                tab.id === activeTabId
                                    ? "bg-purple-500/30 text-white border border-purple-500/40"
                                    : "text-purple-300/70 hover:bg-white/10 hover:text-purple-200 border border-transparent"
                            }`}
                        >
                            <span className="truncate flex-1 text-left">{getTabLabel(tab)}</span>
                            {tabs.length > 1 && (
                                <span
                                    onClick={(e) => handleCloseTab(tab.id, e)}
                                    className="flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded hover:bg-white/20 text-purple-400 hover:text-white opacity-0 group-hover/tab:opacity-100 transition-opacity"
                                >
                                    <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor">
                                        <path d="M6.414 5l2.293-2.293a1 1 0 00-1.414-1.414L5 3.586 2.707 1.293a1 1 0 00-1.414 1.414L3.586 5 1.293 7.293a1 1 0 001.414 1.414L5 6.414l2.293 2.293a1 1 0 001.414-1.414L6.414 5z" />
                                    </svg>
                                </span>
                            )}
                        </button>
                    ))}
                    {tabs.length < 10 && (
                        <button
                            onClick={handleNewTab}
                            className="flex-shrink-0 p-1 rounded-lg hover:bg-white/10 text-purple-400 hover:text-purple-200 transition-colors"
                            title="New tab"
                        >
                            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" />
                            </svg>
                        </button>
                    )}
                </div>

                {/* Right: window controls */}
                <div className="flex items-center gap-1 flex-shrink-0" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
                    <button
                        onClick={() => window.electronAPI.windowMinimize()}
                        className="p-2 rounded-xl hover:bg-white/10 text-purple-300 hover:text-white transition-all duration-200"
                        title="Minimize"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                        </svg>
                    </button>
                    <button
                        onClick={() => window.electronAPI.windowMaximize()}
                        className="p-2 rounded-xl hover:bg-white/10 text-purple-300 hover:text-white transition-all duration-200"
                        title="Maximize"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5 4a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V5a1 1 0 00-1-1H5zm0 2h10v8H5V6z" clipRule="evenodd" />
                        </svg>
                    </button>
                    <button
                        onClick={() => window.electronAPI.windowClose()}
                        className="p-2 rounded-xl hover:bg-red-500/80 text-purple-300 hover:text-white transition-all duration-200"
                        title="Close"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>
            </header>

            <div className="relative flex h-full bg-primary-950 p-3 gap-3 z-0 min-h-0">
                {/* Main Content */}
                {activeTab.viewMode === "explorer" ? (
                    <>
                        <div className="flex-[3] h-full rounded-2xl overflow-hidden glass-panel shadow-glass">
                            <FileExplorer
                                currentPath={activeTab.currentPath}
                                onNavigate={handleFileExplorerNavigate}
                                onFileClick={handleFileClick}
                                onEmbedAll={handleEmbedAll}
                                batchEmbedding={batchEmbedding}
                                batchProgress={batchProgress}
                                refreshKey={folderRefreshKey}
                            />
                        </div>
                        <div className="flex-[2] h-full rounded-2xl overflow-hidden glass-panel shadow-glass">
                            <UnifiedPanel
                                currentPath={activeTab.currentPath}
                                onNavigate={handleFileExplorerNavigate}
                                onFileSelect={(file) => {
                                    handleFileClick(file);
                                    updateActiveTab({ selectedFile: file, viewMode: "viewer" });
                                }}
                                mode="explorer"
                                pdfPath={activeTab.pdfPath}
                                sessionId={sessionId}
                                selectedText={selectedText}
                                onClearSelection={handleClearSelection}
                                onNewSession={handleNewSession}
                                onSessionChange={handleSessionChange}
                                onDeleteSession={handleDeleteSession}
                                onRefreshFolder={() => setFolderRefreshKey((k) => k + 1)}
                                onOpenDocument={handleOpenInNewTab}
                            />
                        </div>
                    </>
                ) : (
                    <>
                        <div className={`h-full rounded-2xl overflow-hidden glass-panel shadow-glass transition-all duration-300 ${tocOpen ? "w-72 opacity-100" : "w-0 opacity-0 overflow-hidden"}`}>
                            {tocOpen && activeTab.pdf && (
                                <TOCPanel pdf={activeTab.pdf} onNavigate={handleNavigate} currentPage={activeTab.currentPage} />
                            )}
                        </div>

                        <div className="flex-[3] h-full rounded-2xl overflow-hidden glass-panel shadow-glass">
                            <div className="h-full flex flex-col">
                                <div className="p-3 border-b border-white/10">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => updateActiveTab({ viewMode: "explorer", selectedFile: null })}
                                                className="p-2 rounded-lg hover:bg-white/10 text-purple-300 hover:text-white transition-colors"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                                </svg>
                                            </button>
                                            <span className="text-white font-medium">{activeTab.selectedFile?.name}</span>
                                        </div>
                                        <button
                                            onClick={() => updateActiveTab({ viewMode: "explorer", selectedFile: null })}
                                            className="p-2 rounded-lg hover:bg-white/10 text-purple-300 hover:text-white transition-colors"
                                        >
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                    {(activeTab.isEmbedding || (batchEmbedding && batchProgress?.fileName === activeTab.fileName)) && (
                                        <div className="mt-2">
                                            <div className="flex items-center justify-between text-xs text-purple-300 mb-1">
                                                <span>Embedding document...</span>
                                                <span>{activeTab.isEmbedding ? activeTab.embeddingProgress : (batchProgress?.fileProgress || 0)}%</span>
                                            </div>
                                            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-purple-500 rounded-full transition-all duration-300"
                                                    style={{ width: `${activeTab.isEmbedding ? activeTab.embeddingProgress : (batchProgress?.fileProgress || 0)}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 overflow-hidden">
                                    <PDFViewer
                                        pdfData={activeTab.pdfData}
                                        onTextSelect={handleTextSelect}
                                        fileName={activeTab.fileName || undefined}
                                        navigateToPage={activeTab.currentPage}
                                        onPageChange={handlePageChange}
                                        onPdfLoad={handlePdfLoad}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex-[2] h-full rounded-2xl overflow-hidden glass-panel shadow-glass">
                            <UnifiedPanel
                                currentPath={activeTab.currentPath}
                                onNavigate={handleFileExplorerNavigate}
                                onFileSelect={(file) => {
                                    handleFileClick(file);
                                    updateActiveTab({ selectedFile: file });
                                }}
                                mode="viewer"
                                pdfPath={activeTab.pdfPath}
                                sessionId={sessionId}
                                selectedText={selectedText}
                                onClearSelection={handleClearSelection}
                                onNewSession={handleNewSession}
                                onSessionChange={handleSessionChange}
                                onDeleteSession={handleDeleteSession}
                                onBack={() => updateActiveTab({ viewMode: "explorer", selectedFile: null })}
                                isEmbedding={activeTab.isEmbedding || (batchEmbedding && batchProgress?.fileName === activeTab.fileName)}
                                embeddingProgress={activeTab.isEmbedding ? activeTab.embeddingProgress : (batchProgress?.fileProgress || 0)}
                                onOpenDocument={handleOpenInNewTab}
                            />
                        </div>
                    </>
                )}

                {/* Documents Panel */}
                <div className={`h-full rounded-2xl overflow-hidden glass-panel shadow-glass transition-all duration-300 ease-in-out ${docsOpen ? "w-80 opacity-100" : "w-0 opacity-0 p-0"}`}>
                    {docsOpen && (
                        <div className="h-full flex flex-col">
                            <div className="p-4 border-b border-white/10">
                                <h3 className="text-lg font-semibold text-purple-200">Documents</h3>
                                <p className="text-xs text-purple-400/70 mt-1">
                                    {documents.filter((doc) => activeTab.currentPath && doc.file_path && doc.file_path.startsWith(activeTab.currentPath)).length} document{documents.filter((doc) => activeTab.currentPath && doc.file_path && doc.file_path.startsWith(activeTab.currentPath)).length !== 1 ? "s" : ""} in folder
                                </p>
                            </div>
                            <div className="flex-1 overflow-y-auto p-2 space-y-2">
                                {batchEmbedding && batchProgress && (
                                    <div className="w-full p-3 rounded-xl bg-white/5 border border-purple-500/30">
                                        <div className="flex items-start gap-3">
                                            <div className="relative">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-purple-400 mt-0.5 opacity-50" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                                                </svg>
                                                <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-purple-500 rounded-full animate-ping opacity-75"></div>
                                                <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-purple-500 rounded-full"></div>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-purple-200 truncate">{batchProgress.fileName}</p>
                                                <p className="text-xs text-purple-400/70 truncate mt-0.5">Embedding document...</p>
                                                <div className="mt-2 h-1 bg-white/10 rounded-full overflow-hidden">
                                                    <div className="h-full bg-purple-500 rounded-full transition-all duration-300" style={{ width: `${Math.min(99, Math.max(0, batchProgress.fileProgress))}%` }} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {documents.filter((doc) => activeTab.currentPath && doc.file_path && doc.file_path.startsWith(activeTab.currentPath)).map((doc) => (
                                    <button
                                        key={doc.id}
                                        onClick={() => handleSwitchDocument(doc.id)}
                                        className={`w-full text-left p-3 rounded-xl transition-all duration-200 ${currentDocId === doc.id ? "bg-purple-500/30 border border-purple-500/30" : "bg-white/5 hover:bg-white/10 border border-transparent"}`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-purple-400 mt-0.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                                            </svg>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between">
                                                    <p className="text-sm font-medium text-purple-200 truncate">{doc.file_name}</p>
                                                    <button
                                                        onClick={(e) => handleDeleteDocument(e, doc.id)}
                                                        className="p-1 rounded-lg hover:bg-red-500/30 text-purple-400 hover:text-red-400 transition-colors"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                                        </svg>
                                                    </button>
                                                </div>
                                                <p className="text-xs text-purple-400/60 mt-1">{doc.total_chunks} chunks • {new Date(doc.last_accessed).toLocaleDateString()}</p>
                                                {currentDocId === doc.id && (
                                                    <span className="inline-block mt-2 text-xs bg-purple-500/30 text-purple-300 px-2 py-0.5 rounded-full">Current</span>
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
                        className={`p-2 rounded-full transition-all duration-200 ${docsOpen ? "bg-purple-500/30 text-purple-200" : "bg-white/5 text-primary-300 hover:bg-white/10"}`}
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
                        className={`p-2 rounded-full transition-all duration-200 ${tocOpen ? "bg-purple-500/30 text-purple-200" : "bg-white/5 text-primary-300 hover:bg-white/10"}`}
                        title="Toggle Table of Contents"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M2 4a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1H3a1 1 0 01-1-1V4zM4 8a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V8zM2 14a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1H3a1 1 0 01-1-1v-2zM8 12a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H9a1 1 0 01-1-1v-2z" />
                        </svg>
                    </button>
                    <div className="w-px h-5 bg-white/10" />
                    <button
                        onClick={() => setChatOpen(!chatOpen)}
                        className={`p-2 rounded-full transition-all duration-200 ${chatOpen ? "bg-purple-500/30 text-purple-200" : "bg-white/5 text-primary-300 hover:bg-white/10"}`}
                        title="Toggle Chat"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>
            </div>

            <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </div>
    );
}

export default App;
