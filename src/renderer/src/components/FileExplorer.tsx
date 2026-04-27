import React, { useState, useEffect, useCallback } from "react";

interface FileEntry {
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    modified: string;
}

interface FileExplorerProps {
    onFileClick: (file: FileEntry) => void;
    onNavigate: (path: string) => void;
    currentPath: string;
    onEmbedAll?: () => void;
    batchEmbedding?: boolean;
    batchProgress?: {
        fileName: string;
        fileIndex: number;
        totalFiles: number;
        fileProgress: number;
    } | null;
    refreshKey?: number;
}

export default function FileExplorer({ onFileClick, onNavigate, currentPath, onEmbedAll, batchEmbedding, batchProgress, refreshKey }: FileExplorerProps) {
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState<"list" | "grid">("list");
    const [breadcrumbs, setBreadcrumbs] = useState<string[]>([]);
    const [embeddedMap, setEmbeddedMap] = useState<Map<string, string>>(new Map());
    const [allEmbedded, setAllEmbedded] = useState(false);
    const [removingAll, setRemovingAll] = useState(false);

    const loadEmbedded = useCallback(async () => {
        try {
            const docs = await window.electronAPI.documents.list();
            const map = new Map<string, string>();
            docs.forEach((doc: { id: string; file_path: string }) => {
                map.set(doc.file_path, doc.id);
            });
            setEmbeddedMap(map);
        } catch (error) {
            console.error("Error loading embedded docs:", error);
        }
    }, []);

    const checkAllEmbedded = useCallback(async () => {
        if (!currentPath) return;
        try {
            const embeddedCount = await window.electronAPI.documents.countByPath(currentPath);
            setAllEmbedded(embeddedCount > 0);
        } catch (error) {
            console.error("Error checking embedded status:", error);
        }
    }, [currentPath]);

    const handleRemoveAll = useCallback(async () => {
        if (!currentPath || removingAll) return;
        try {
            setRemovingAll(true);
            await window.electronAPI.documents.deleteByPath(currentPath);
            await loadEmbedded();
            checkAllEmbedded();
        } catch (error) {
            console.error("Error removing all embedded docs:", error);
        } finally {
            setRemovingAll(false);
        }
    }, [currentPath, removingAll, loadEmbedded, checkAllEmbedded]);

    useEffect(() => {
        if (!currentPath) {
            setLoading(true);
            return;
        }
        const loadDirectory = async () => {
            setLoading(true);
            try {
                const entries = await window.electronAPI.fs.readDir(currentPath);
                if (entries) {
                    setFiles(entries);
                    await loadEmbedded();
                    await checkAllEmbedded();
                }
            } catch (error) {
                console.error("Error loading directory:", error);
            } finally {
                setLoading(false);
            }
        };
        loadDirectory();
    }, [currentPath, refreshKey, loadEmbedded, checkAllEmbedded]);

    useEffect(() => {
        if (currentPath) {
            const parts = currentPath.split(/[/\\]/).filter(Boolean);
            setBreadcrumbs(parts);
        }
    }, [currentPath]);

    const handleItemClick = useCallback((file: FileEntry) => {
        if (file.isDirectory) {
            onNavigate(file.path);
        } else {
            onFileClick(file);
        }
    }, [onFileClick, onNavigate]);

    const handleBreadcrumbClick = useCallback((index: number) => {
        const pathParts = currentPath.split(/[/\\]/).filter(Boolean);
        const newPath = "/" + pathParts.slice(0, index + 1).join("/");
        onNavigate(newPath);
    }, [currentPath, onNavigate]);

    const handleDeleteEmbedded = useCallback(async (e: React.MouseEvent, hash: string) => {
        e.stopPropagation();
        try {
            await window.electronAPI.documents.delete(hash);
            await loadEmbedded();
        } catch (error) {
            console.error("Error deleting embedded doc:", error);
        }
    }, [loadEmbedded]);

    const getFileIcon = (file: FileEntry) => {
        if (file.isDirectory) {
            return (
                <svg className="w-8 h-8 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                </svg>
            );
        }
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (ext === "pdf") {
            return (
                <svg className="w-8 h-8 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                </svg>
            );
        }
        if (ext === "txt" || ext === "md") {
            return (
                <svg className="w-8 h-8 text-purple-300" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                </svg>
            );
        }
        return (
            <svg className="w-8 h-8 text-purple-300/60" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
            </svg>
        );
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    };

    return (
        <div className="flex flex-col h-full bg-primary-950">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 px-4 py-3 bg-primary-900/50 border-b border-white/10 overflow-x-auto">
                <button
                    onClick={() => window.electronAPI.fs.getParentDir(currentPath).then(p => p && onNavigate(p))}
                    className="p-1.5 rounded-lg hover:bg-white/10 text-purple-300 hover:text-white transition-colors flex-shrink-0"
                    title="Go up"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
                <div className="flex items-center gap-1 text-sm overflow-x-auto">
                    {breadcrumbs.map((part, index) => (
                        <div key={index} className="flex items-center gap-1 flex-shrink-0">
                            {index > 0 && <span className="text-purple-500">/</span>}
                            <button
                                onClick={() => handleBreadcrumbClick(index)}
                                className="px-2 py-1 rounded hover:bg-white/10 text-purple-200 hover:text-white transition-colors truncate max-w-[150px]"
                            >
                                {part}
                            </button>
                        </div>
                    ))}
                </div>
                <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                    {allEmbedded ? (
                        <button
                            onClick={handleRemoveAll}
                            disabled={removingAll}
                            className="p-2 rounded-lg transition-colors flex items-center gap-2 text-sm hover:bg-red-500/20 text-red-400"
                            title="Remove all from vector store"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            <span className="hidden sm:inline">{removingAll ? "Removing..." : "Remove All"}</span>
                        </button>
                    ) : (
                        <button
                            onClick={onEmbedAll}
                            disabled={batchEmbedding}
                            className={`p-2 rounded-lg transition-colors flex items-center gap-2 text-sm ${batchEmbedding ? "bg-purple-500/20 text-purple-300 opacity-50 cursor-not-allowed" : "hover:bg-purple-500/20 text-purple-300 hover:text-purple-200"}`}
                            title="Embed all PDFs in this directory"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                            </svg>
                            <span className="hidden sm:inline">{batchEmbedding ? "Embedding..." : "Embed All"}</span>
                        </button>
                    )}
                    <div className="w-px h-5 bg-white/10 mx-1"></div>
                    <button
                        onClick={() => setViewMode(viewMode === "list" ? "grid" : "list")}
                        className="p-2 rounded-lg hover:bg-white/10 text-purple-300 hover:text-white transition-colors"
                        title={viewMode === "list" ? "Grid view" : "List view"}
                    >
                        {viewMode === "list" ? (
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                            </svg>
                        ) : (
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>

            {/* Batch Progress Bar */}
            {batchEmbedding && batchProgress && (
                <div className="px-4 py-3 bg-purple-500/10 border-b border-white/10">
                    <div className="flex items-center justify-between text-xs text-purple-200 mb-2">
                        <div className="flex items-center gap-2 truncate">
                            <span className="font-medium bg-purple-500/30 px-2 py-0.5 rounded">
                                {batchProgress.fileIndex + 1} / {batchProgress.totalFiles}
                            </span>
                            <span className="truncate max-w-[200px] text-purple-300">
                                {batchProgress.fileName}
                            </span>
                        </div>
                        <span className="flex-shrink-0 font-medium">{batchProgress.fileProgress}%</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-purple-500 rounded-full transition-all duration-300"
                            style={{ width: `${batchProgress.fileProgress}%` }}
                        />
                    </div>
                </div>
            )}

            {/* File List */}
            <div className="flex-1 overflow-auto p-4">
                {loading ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400"></div>
                    </div>
                ) : viewMode === "list" ? (
                    <table className="w-full">
                        <thead className="text-left text-xs text-purple-400/60 uppercase">
                            <tr>
                                <th className="pb-2 font-medium">Name</th>
                                <th className="pb-2 font-medium w-24">Size</th>
                                <th className="pb-2 font-medium w-40">Modified</th>
                            </tr>
                        </thead>
                        <tbody>
                            {files.map((file) => (
                                <tr
                                    key={file.path}
                                    onClick={() => handleItemClick(file)}
                                    className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
                                >
                                    <td className="py-3">
                                        <div className="flex items-center gap-3">
                                            {getFileIcon(file)}
                                            <span className="text-purple-100 truncate">{file.name}</span>
                                            {embeddedMap.has(file.path) && (
                                                <div className="flex items-center gap-1">
                                                    <span className="text-[10px] bg-green-500/20 text-green-300 rounded-full border border-green-500/30 px-1.5 py-0.5">
                                                        Embedded
                                                    </span>
                                                    <button
                                                        onClick={(e) => handleDeleteEmbedded(e, embeddedMap.get(file.path)!)}
                                                        className="p-1 text-primary-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all duration-200"
                                                        title="Remove from vector store"
                                                    >
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="py-3 text-purple-300/60 text-sm">
                                        {file.isDirectory ? "--" : formatSize(file.size)}
                                    </td>
                                    <td className="py-3 text-purple-300/60 text-sm">
                                        {formatDate(file.modified)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
                        {files.map((file) => (
                            <div key={file.path} className="relative">
                                <button
                                    onClick={() => handleItemClick(file)}
                                    className="flex flex-col items-center gap-2 p-4 rounded-xl hover:bg-white/5 transition-colors w-full"
                                >
                                    {getFileIcon(file)}
                                    <span className="text-sm text-purple-100 text-center truncate w-full">
                                        {file.name}
                                    </span>
                                </button>
                                {embeddedMap.has(file.path) && (
                                    <div className="absolute top-1 right-1 flex items-center gap-1">
                                        <span className="text-[8px] bg-green-500/20 text-green-300 rounded-full border border-green-500/30 px-1 py-0.5">
                                            Embedded
                                        </span>
                                        <button
                                            onClick={(e) => handleDeleteEmbedded(e, embeddedMap.get(file.path)!)}
                                            className="p-1 text-primary-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all duration-200"
                                            title="Remove from vector store"
                                        >
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
                {files.length === 0 && !loading && (
                    <div className="flex flex-col items-center justify-center h-64 text-purple-400/50">
                        <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        <p>This folder is empty</p>
                    </div>
                )}
            </div>
        </div>
    );
}
