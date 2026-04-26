import React, { useState, useEffect, useCallback, useMemo, memo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import ChatInput from "./ChatInput";
import DocumentRecommendations from "./DocumentRecommendations";

interface DocumentSuggestion {
    id: string;
    file_name: string;
    file_path: string;
    snippet: string;
}

interface FileEntry {
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    modified: string;
}

interface UnifiedPanelProps {
    currentPath: string;
    onNavigate: (path: string) => void;
    onFileSelect: (file: FileEntry) => void;
    mode: "explorer" | "viewer";
    pdfPath?: string | null;
    sessionId?: number | null;
    onBack?: () => void;
    selectedText?: string | null;
    onClearSelection?: () => void;
    isEmbedding?: boolean;
    embeddingProgress?: number;
    onNewSession?: () => void;
    onSessionChange?: (sessionId: number) => void;
    onDeleteSession?: (sessionId: number) => void;
    onRefreshFolder?: () => void;
    onOpenDocument?: (filePath: string, fileName: string) => void;
}

interface Message {
    role: "user" | "assistant" | "tool";
    content: string;
}

interface Session {
    id: number;
    pdf_path: string;
    created_at: string;
    updated_at: string;
}

export default function UnifiedPanel({ currentPath, onNavigate, onFileSelect, mode, sessionId, onBack, selectedText, onClearSelection, isEmbedding, embeddingProgress, onNewSession, onSessionChange, onDeleteSession, onRefreshFolder, onOpenDocument }: UnifiedPanelProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(false);

    // Streaming state
    const [streamingContent, setStreamingContent] = useState("");
    const [activeTool, setActiveTool] = useState<{ name: string, input?: any } | null>(null);
    const [completedTools, setCompletedTools] = useState<{ name: string, output?: any }[]>([]);

    // Auto-scroll ref
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, []);

    // Organize confirmation state
    const [organizePlan, setOrganizePlan] = useState<{
        targetPath: string;
        strategy: string;
        flatten: boolean;
        groups: { folder: string; files: string[]; filePaths?: string[] }[];
        subfoldersScanned?: string[];
        totalFiles?: number;
    }[]>([]);

    // Convert confirmation state
    const [convertPlan, setConvertPlan] = useState<{
        files: { filePath: string; outputPath: string; fileName: string; fileSize: number }[];
        totalFiles: number;
        totalSize: number;
    }[]>([]);

    // Move confirmation state
    const [movePlan, setMovePlan] = useState<{
        moves: { from: string; to: string; fileName: string }[];
    }[]>([]);

    // Rename confirmation state
    const [renamePlan, setRenamePlan] = useState<{
        oldPath: string;
        newPath: string;
        oldName: string;
        newName: string;
    }[]>([]);

    // Delete confirmation state
    const [deletePlan, setDeletePlan] = useState<{
        files: { path: string; name: string; isDirectory: boolean; size?: number }[];
    }[]>([]);

    // Document recommendations state
    const [docRecommendations, setDocRecommendations] = useState<DocumentSuggestion[]>([]);
    const sessionIdRef = useRef(sessionId);
    useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

    // Session management state
    const [sessions, setSessions] = useState<Session[]>([]);
    const [sessionsOpen, setSessionsOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);

    // Fetch sessions list
    const loadSessions = useCallback(async () => {
        try {
            const allSessions = await window.electronAPI.getSessions();
            setSessions(allSessions);
        } catch (e) {
            console.error('Failed to load sessions', e);
        }
    }, []);

    useEffect(() => {
        loadSessions();
    }, [sessionId, loadSessions]);

    // Close dropdowns when clicking outside
    useEffect(() => {
        const handleClickOutside = () => {
            setSessionsOpen(false);
            setMenuOpen(false);
        };
        if (sessionsOpen || menuOpen) {
            document.addEventListener("click", handleClickOutside);
            return () => document.removeEventListener("click", handleClickOutside);
        }
    }, [sessionsOpen, menuOpen]);

    useEffect(() => {
        // Setup chunk listener
        const removeChunkListener = window.electronAPI.onAgentChunk((chunk: string) => {
            setStreamingContent(prev => prev + chunk);
        });

        const removeToolListener = window.electronAPI.onAgentTool((toolCall: any) => {
            if (toolCall.type === 'start') {
                setActiveTool({ name: toolCall.name, input: toolCall.input });
                setStreamingContent(""); // Clear text when starting a tool to keep it clean
            } else if (toolCall.type === 'end') {
                setCompletedTools(prev => [...prev, { name: toolCall.name, output: toolCall.output }]);
                setActiveTool(null);
                
                // Check if this is an organize_plan response
                if (toolCall.name === 'organize_folder' && toolCall.output) {
                    try {
                        // Handle LangChain message format
                        let outputContent: string;
                        if (typeof toolCall.output === 'string') {
                            outputContent = toolCall.output;
                        } else if (toolCall.output.lc_kwargs?.content) {
                            outputContent = toolCall.output.lc_kwargs.content;
                        } else if (toolCall.output.content) {
                            outputContent = toolCall.output.content;
                        } else {
                            outputContent = JSON.stringify(toolCall.output);
                        }
                        
                        const output = JSON.parse(outputContent);
                        if (output.type === 'organize_plan') {
                            setOrganizePlan(prev => [...prev, {
                                targetPath: output.targetPath,
                                strategy: output.strategy || 'type',
                                flatten: output.flatten || false,
                                groups: output.groups,
                                subfoldersScanned: output.subfoldersScanned,
                                totalFiles: output.totalFiles
                            }]);
                        }
                    } catch (e) {
                        // Not JSON, ignore
                    }
                }

                // Check if this is a convert_plan response
                if (toolCall.name === 'convert_document' && toolCall.output) {
                    try {
                        let outputContent: string;
                        if (typeof toolCall.output === 'string') {
                            outputContent = toolCall.output;
                        } else if (toolCall.output.lc_kwargs?.content) {
                            outputContent = toolCall.output.lc_kwargs.content;
                        } else if (toolCall.output.content) {
                            outputContent = toolCall.output.content;
                        } else {
                            outputContent = JSON.stringify(toolCall.output);
                        }

                        const output = JSON.parse(outputContent);
                        if (output.type === 'convert_plan' && output.files && output.files.length > 0) {
                            setConvertPlan(prev => [...prev, {
                                files: output.files,
                                totalFiles: output.totalFiles,
                                totalSize: output.totalSize
                            }]);
                        }
                    } catch (e) {
                        // Not JSON, ignore
                    }
                }

                // Check for move_plan
                if (toolCall.name === 'move_files' && toolCall.output) {
                    try {
                        let outputContent: string;
                        if (typeof toolCall.output === 'string') outputContent = toolCall.output;
                        else if (toolCall.output.lc_kwargs?.content) outputContent = toolCall.output.lc_kwargs.content;
                        else if (toolCall.output.content) outputContent = toolCall.output.content;
                        else outputContent = JSON.stringify(toolCall.output);
                        const output = JSON.parse(outputContent);
                        if (output.type === 'move_plan' && output.moves && output.moves.length > 0) {
                            setMovePlan(prev => [...prev, { moves: output.moves }]);
                        }
                    } catch (e) {}
                }

                // Check for rename_plan
                if (toolCall.name === 'rename_file' && toolCall.output) {
                    try {
                        let outputContent: string;
                        if (typeof toolCall.output === 'string') outputContent = toolCall.output;
                        else if (toolCall.output.lc_kwargs?.content) outputContent = toolCall.output.lc_kwargs.content;
                        else if (toolCall.output.content) outputContent = toolCall.output.content;
                        else outputContent = JSON.stringify(toolCall.output);
                        const output = JSON.parse(outputContent);
                        if (output.type === 'rename_plan' && output.oldPath && !output.error) {
                            setRenamePlan(prev => [...prev, { oldPath: output.oldPath, newPath: output.newPath, oldName: output.oldName, newName: output.newName }]);
                        }
                    } catch (e) {}
                }

                // Check for delete_plan
                if (toolCall.name === 'delete_files' && toolCall.output) {
                    try {
                        let outputContent: string;
                        if (typeof toolCall.output === 'string') outputContent = toolCall.output;
                        else if (toolCall.output.lc_kwargs?.content) outputContent = toolCall.output.lc_kwargs.content;
                        else if (toolCall.output.content) outputContent = toolCall.output.content;
                        else outputContent = JSON.stringify(toolCall.output);
                        const output = JSON.parse(outputContent);
                        if (output.type === 'delete_plan' && output.files && output.files.length > 0) {
                            setDeletePlan(prev => [...prev, { files: output.files }]);
                        }
                    } catch (e) {}
                }

                // Check for document_recommendations
                if (toolCall.name === 'recommend_documents' && toolCall.output) {
                    try {
                        let outputContent: string;
                        if (typeof toolCall.output === 'string') outputContent = toolCall.output;
                        else if (toolCall.output.lc_kwargs?.content) outputContent = toolCall.output.lc_kwargs.content;
                        else if (toolCall.output.content) outputContent = toolCall.output.content;
                        else outputContent = JSON.stringify(toolCall.output);
                        console.log('[recommend_documents] raw output:', outputContent.substring(0, 300));
                        const output = JSON.parse(outputContent);
                        console.log('[recommend_documents] parsed docs count:', output.documents?.length);
                        if (output.type === 'document_recommendations' && output.documents && output.documents.length > 0) {
                            setDocRecommendations(output.documents);
                            if (sessionIdRef.current) {
                                localStorage.setItem(`doc_recs_${sessionIdRef.current}`, JSON.stringify(output.documents));
                            }
                        }
                    } catch (e) {}
                }
            }
        });

        return () => {
            removeChunkListener();
            removeToolListener();
        };
    }, []);


    const loadMessages = useCallback(async (append: boolean = false) => {
        if (!sessionId) return 0;
        const msgs = await window.electronAPI.getMessages(sessionId);
        
        if (msgs.length === 0 && !append) {
            setMessages([
                { role: "assistant", content: "Hi! I'm your AI assistant. I can help you navigate files or answer questions about your documents. Ask me anything!" }
            ]);
        } else if (msgs.length > 0) {
            const sanitizedMsgs = msgs.map((msg: any) => ({
                ...msg,
                role: msg.role as 'user' | 'assistant' | 'tool',
                content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
            }));
            if (append) {
                setMessages(prev => {
                    const existingIds = new Set(prev.map(m => (m as any).id));
                    const newMsgs = sanitizedMsgs.filter((m: any) => !existingIds.has(m.id));
                    if (newMsgs.length > 0) {
                        return [...prev, ...newMsgs];
                    }
                    return prev;
                });
            } else {
                setMessages(sanitizedMsgs);
            }
        }
        if (!append) {
            try {
                const saved = localStorage.getItem(`doc_recs_${sessionId}`);
                if (saved) setDocRecommendations(JSON.parse(saved));
                else setDocRecommendations([]);
            } catch (e) {}
        }
        return msgs.length;
    }, [sessionId]);

    useEffect(() => {
        if (sessionId) {
            loadMessages();
        }
    }, [sessionId, loadMessages]);

    // Auto-scroll effect - runs after every render
    useEffect(() => {
        requestAnimationFrame(() => {
            scrollToBottom();
        });
    }, [messages.length, streamingContent, loading, scrollToBottom]);


    const parseMessage = (content: string): { mainText: string; attachedText: string | null } => {
        let mainText = content;
        const contextMatch = mainText.match(/^\[System Context:[^\]]*\]\n([\s\S]*)$/);
        if (contextMatch) {
            mainText = contextMatch[1];
        }

        const match = mainText.match(/^\[\[TEXT:([\s\S]+?)\]\]\n([\s\S]*)$/);
        if (match) {
            return { mainText: match[2], attachedText: match[1] };
        }
        return { mainText, attachedText: null };
    };

    const handleSubmit = useCallback((userInput: string) => {
        if (!userInput.trim() || loading) return;

        const contextStr = mode === "explorer" ? "file explorer" : "document viewer";
        const prefix = `[System Context: User is currently in ${contextStr} mode. Current folder: ${currentPath}]\n`;

        const fullMessage = selectedText
            ? `${prefix}[[TEXT:${selectedText}]]\n${userInput}`
            : `${prefix}${userInput}`;

        if (onClearSelection) onClearSelection();
        setDocRecommendations([]);
        if (sessionId) localStorage.removeItem(`doc_recs_${sessionId}`);
        setLoading(true);

        if (sessionId) {
            // Optimistically add user message to UI
            setMessages(prev => [...prev, { role: "user", content: fullMessage }]);
            
            window.electronAPI.addMessage(sessionId, "user", fullMessage).then(async () => {
                const msgCountBefore = messages.length;
                window.electronAPI.ask(fullMessage, sessionId, currentPath).then(async (response) => {
                    // Once ask resolves, save final messages to DB and append to UI
                    if (response && Array.isArray(response.messages) && response.messages.length > 0) {
                        const newMessages = response.messages.slice(msgCountBefore);
                        const assistantMessages: Message[] = [];
                        for (const msg of newMessages) {
                            const role = msg.type === 'tool' ? 'tool' : 'assistant';
                            let content: string;
                            if (msg.type === 'tool') {
                                content = typeof msg.name === 'string' ? msg.name : JSON.stringify(msg.name);
                            } else {
                                content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                            }
                            await window.electronAPI.addMessage(sessionId, role, content);
                            assistantMessages.push({ role, content });
                        }
                        // Append assistant messages to UI
                        setMessages(prev => [...prev, ...assistantMessages]);
                    } else {
                        const errorMsg = 'No response available.';
                        await window.electronAPI.addMessage(sessionId, 'assistant', errorMsg);
                        setMessages(prev => [...prev, { role: "assistant", content: errorMsg }]);
                    }
                    setStreamingContent("");
                    setActiveTool(null);
                    setCompletedTools([]);
                    setLoading(false);
                }).catch(async (err) => {
                    const errorMsg = 'Error: ' + (err?.message || "Unknown error");
                    await window.electronAPI.addMessage(sessionId, 'assistant', errorMsg);
                    setMessages(prev => [...prev, { role: "assistant", content: errorMsg }]);
                    setStreamingContent("");
                    setActiveTool(null);
                    setCompletedTools([]);
                    setLoading(false);
                });
            }).catch(async (err) => {
                const errorMsg = 'Error: ' + (err?.message || "Failed to send message");
                await window.electronAPI.addMessage(sessionId, 'assistant', errorMsg);
                setMessages(prev => [...prev, { role: "assistant", content: errorMsg }]);
                setLoading(false);
            });
        } else {
            setMessages(prev => [...prev, { role: "assistant", content: "No active session." }]);
            setLoading(false);
        }
    }, [loading, mode, sessionId, selectedText, onClearSelection, currentPath, messages.length]);

    const handleOrganizeConfirm = useCallback(async () => {
        if (organizePlan.length === 0 || !sessionId) return;

        const plan = organizePlan[0];
        const { targetPath, strategy, flatten } = plan;
        setOrganizePlan(prev => prev.slice(1));
        setLoading(true);

        // Directly call the IPC handler to organize
        try {
            const hasCustomGroups = plan.groups.some(g => g.filePaths && g.filePaths.length > 0);
            const result = await window.electronAPI.fs.organizeFolder({
                action: "organize",
                targetPath,
                strategy: strategy || 'type',
                flatten: flatten || false,
                ...(hasCustomGroups ? {
                    customGroups: plan.groups.map(g => ({
                        folder: g.folder,
                        filePaths: g.filePaths || []
                    }))
                } : {})
            });

            let responseMsg = "";
            if (result.cancelled) {
                responseMsg = "Operation was cancelled.";
            } else if (result.success) {
                responseMsg = `Successfully organized ${result.moved} files using ${result.strategy || (flatten ? 'flatten' : 'type')} strategy.`;
                // Refresh folder if the organized folder is the same as or under current folder
                if (onRefreshFolder && (targetPath === currentPath || currentPath.startsWith(targetPath))) {
                    onRefreshFolder();
                }
            } else {
                responseMsg = `Error organizing folder: ${result.error}`;
            }

            await window.electronAPI.addMessage(sessionId, "assistant", responseMsg);
            setMessages(prev => [...prev, { role: "assistant", content: responseMsg }]);
        } catch (e) {
            const errorMsg = "Error: Failed to organize folder";
            await window.electronAPI.addMessage(sessionId, "assistant", errorMsg);
            setMessages(prev => [...prev, { role: "assistant", content: errorMsg }]);
        }

        setLoading(false);
    }, [organizePlan, sessionId, loadMessages, currentPath, onRefreshFolder]);

    const handleOrganizeCancel = useCallback(() => {
        setOrganizePlan(prev => prev.slice(1));
    }, []);

    const handleConvertConfirm = useCallback(async () => {
        if (convertPlan.length === 0 || !sessionId) return;

        const plan = convertPlan[0];
        const { files } = plan;
        setConvertPlan(prev => prev.slice(1));
        setLoading(true);

        try {
            const filesToConvert = files.map(f => ({
                inputPath: f.filePath,
                outputPath: f.outputPath
            }));
            const result = await window.electronAPI.convertDocument.execute(filesToConvert);

            let responseMsg = "";
            if (result.success) {
                responseMsg = `Successfully converted ${result.successCount}/${result.totalFiles} files. Failed: ${result.failedCount}`;
                // Refresh folder if any output file is in current folder or subfolder
                if (onRefreshFolder) {
                    const isInCurrentFolder = files.some(f => {
                        const outputDir = f.outputPath.substring(0, Math.max(f.outputPath.lastIndexOf('/'), f.outputPath.lastIndexOf('\\')));
                        return outputDir === currentPath || outputDir.startsWith(currentPath + '/') || outputDir.startsWith(currentPath + '\\');
                    });
                    if (isInCurrentFolder) {
                        onRefreshFolder();
                    }
                }
            } else {
                responseMsg = `Error converting documents`;
            }

            await window.electronAPI.addMessage(sessionId, "assistant", responseMsg);
            setMessages(prev => [...prev, { role: "assistant", content: responseMsg }]);
        } catch (e) {
            const errorMsg = "Error: Failed to convert documents";
            await window.electronAPI.addMessage(sessionId, "assistant", errorMsg);
            setMessages(prev => [...prev, { role: "assistant", content: errorMsg }]);
        }

        setLoading(false);
    }, [convertPlan, sessionId, loadMessages, currentPath, onRefreshFolder]);

    const handleConvertCancel = useCallback(() => {
        setConvertPlan(prev => prev.slice(1));
    }, []);

    const handleMoveConfirm = useCallback(async () => {
        if (movePlan.length === 0 || !sessionId) return;
        const { moves } = movePlan[0];
        setMovePlan(prev => prev.slice(1));
        setLoading(true);
        try {
            const result = await window.electronAPI.fs.moveFiles(moves);
            const responseMsg = result.success
                ? `Moved ${result.successCount}/${moves.length} file(s) successfully.`
                : `Error moving files: ${result.results.filter(r => !r.success).map(r => r.error).join(', ')}`;
            if (onRefreshFolder) onRefreshFolder();
            await window.electronAPI.addMessage(sessionId, "assistant", responseMsg);
            setMessages(prev => [...prev, { role: "assistant", content: responseMsg }]);
        } catch (e) {
            const errorMsg = "Error: Failed to move files";
            await window.electronAPI.addMessage(sessionId, "assistant", errorMsg);
            setMessages(prev => [...prev, { role: "assistant", content: errorMsg }]);
        }
        setLoading(false);
    }, [movePlan, sessionId, onRefreshFolder]);

    const handleMoveCancel = useCallback(() => setMovePlan(prev => prev.slice(1)), []);

    const handleRenameConfirm = useCallback(async () => {
        if (renamePlan.length === 0 || !sessionId) return;
        const plan = renamePlan[0];
        const { oldPath, newPath } = plan;
        setRenamePlan(prev => prev.slice(1));
        setLoading(true);
        try {
            const result = await window.electronAPI.fs.moveFiles([{ from: oldPath, to: newPath }]);
            const responseMsg = result.success
                ? `Renamed successfully: ${plan.oldName} → ${plan.newName}`
                : `Error renaming: ${result.results[0]?.error || 'Unknown error'}`;
            if (onRefreshFolder) onRefreshFolder();
            await window.electronAPI.addMessage(sessionId, "assistant", responseMsg);
            setMessages(prev => [...prev, { role: "assistant", content: responseMsg }]);
        } catch (e) {
            const errorMsg = "Error: Failed to rename file";
            await window.electronAPI.addMessage(sessionId, "assistant", errorMsg);
            setMessages(prev => [...prev, { role: "assistant", content: errorMsg }]);
        }
        setLoading(false);
    }, [renamePlan, sessionId, onRefreshFolder]);

    const handleRenameCancel = useCallback(() => setRenamePlan(prev => prev.slice(1)), []);

    const handleDeleteConfirm = useCallback(async () => {
        if (deletePlan.length === 0 || !sessionId) return;
        const { files } = deletePlan[0];
        setDeletePlan(prev => prev.slice(1));
        setLoading(true);
        try {
            const result = await window.electronAPI.fs.deleteFiles(files.map(f => f.path));
            const responseMsg = result.success
                ? `Deleted ${result.successCount}/${files.length} item(s) successfully.`
                : `Error deleting: ${result.results.filter(r => !r.success).map(r => r.error).join(', ')}`;
            if (onRefreshFolder) onRefreshFolder();
            await window.electronAPI.addMessage(sessionId, "assistant", responseMsg);
            setMessages(prev => [...prev, { role: "assistant", content: responseMsg }]);
        } catch (e) {
            const errorMsg = "Error: Failed to delete files";
            await window.electronAPI.addMessage(sessionId, "assistant", errorMsg);
            setMessages(prev => [...prev, { role: "assistant", content: errorMsg }]);
        }
        setLoading(false);
    }, [deletePlan, sessionId, onRefreshFolder]);

    const handleDeleteCancel = useCallback(() => setDeletePlan(prev => prev.slice(1)), []);

    const formatSessionDate = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const mins = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        if (mins < 1) return "Just now";
        if (mins < 60) return `${mins}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;
        return date.toLocaleDateString();
    };

    return (
        <div className="flex flex-col h-full bg-primary-950">
            {/* Chat Header with Session Management */}
            <div className="p-3 border-b border-white/10">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 text-xs rounded-full ${mode === "explorer" ? "bg-purple-500/30 text-purple-200" : "bg-blue-500/30 text-blue-200"}`}>
                            {mode === "explorer" ? "📁 File Navigation" : "📄 Document Chat"}
                        </span>
                    </div>
                    <div className="flex items-center gap-1">
                        {/* New Session */}
                        <button
                            onClick={() => onNewSession?.()}
                            className="p-1.5 rounded-lg hover:bg-white/10 text-purple-300 hover:text-white transition-all duration-200"
                            title="New Session"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                        </button>

                        {/* Sessions List */}
                        <div className="relative">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSessionsOpen(!sessionsOpen);
                                    setMenuOpen(false);
                                }}
                                className={`p-1.5 rounded-lg hover:bg-white/10 transition-all duration-200 ${sessionsOpen ? "bg-white/10 text-white" : "text-purple-300 hover:text-white"}`}
                                title="Session History"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </button>

                            {/* Sessions Dropdown */}
                            {sessionsOpen && (
                                <div className="absolute right-0 top-full mt-2 w-64 max-h-80 overflow-y-auto bg-primary-800 backdrop-blur-xl rounded-xl shadow-2xl border border-white/10 z-50" onClick={(e) => e.stopPropagation()}>
                                    <div className="p-2">
                                        <p className="text-xs text-purple-400 px-2 py-1 font-medium">Sessions</p>
                                        {sessions.length === 0 ? (
                                            <p className="text-xs text-purple-400/50 px-2 py-3 text-center">No sessions yet</p>
                                        ) : sessions.map((session) => (
                                            <button
                                                key={session.id}
                                                onClick={() => {
                                                    onSessionChange?.(session.id);
                                                    setSessionsOpen(false);
                                                }}
                                                className={`w-full text-left px-3 py-2 rounded-lg transition-all duration-200 ${sessionId === session.id
                                                    ? "bg-purple-500/20 border border-purple-500/30"
                                                    : "hover:bg-white/5"
                                                    }`}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <svg className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                                                        </svg>
                                                        <span className="text-sm text-purple-200 truncate">
                                                            Session {session.id}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 flex-shrink-0">
                                                        <span className="text-xs text-purple-400/60">{formatSessionDate(session.updated_at)}</span>
                                                        {sessionId === session.id && (
                                                            <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                                                        )}
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Menu */}
                        <div className="relative">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setMenuOpen(!menuOpen);
                                    setSessionsOpen(false);
                                }}
                                className={`p-1.5 rounded-lg hover:bg-white/10 transition-all duration-200 ${menuOpen ? "bg-white/10 text-white" : "text-purple-300 hover:text-white"}`}
                                title="More Options"
                            >
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                                </svg>
                            </button>

                            {/* Menu Dropdown */}
                            {menuOpen && (
                                <div className="absolute right-0 top-full mt-2 w-48 bg-primary-800 backdrop-blur-xl rounded-xl shadow-2xl border border-white/10 z-50" onClick={(e) => e.stopPropagation()}>
                                    <div className="p-1">
                                        <button
                                            onClick={() => {
                                                if (sessionId && onDeleteSession) {
                                                    onDeleteSession(sessionId);
                                                }
                                                setMenuOpen(false);
                                            }}
                                            className="w-full px-3 py-2 text-left text-sm text-red-300 hover:text-red-200 hover:bg-red-500/10 rounded-lg transition-all duration-200 flex items-center gap-2"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                            Delete Session
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (sessionId) {
                                                    window.electronAPI.clearMessages(sessionId).then(() => {
                                                        loadMessages();
                                                    });
                                                }
                                                setMenuOpen(false);
                                            }}
                                            className="w-full px-3 py-2 text-left text-sm text-purple-300 hover:text-purple-200 hover:bg-white/5 rounded-lg transition-all duration-200 flex items-center gap-2"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                            </svg>
                                            Clear Messages
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {mode === "viewer" && onBack && (
                            <button
                                onClick={onBack}
                                className="ml-1 px-2 py-1 text-xs bg-white/10 hover:bg-white/20 text-purple-200 rounded-lg transition-colors"
                            >
                                ← Back
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Embedding Progress Bar */}
            {mode === "viewer" && isEmbedding && (
                <div className="p-3 border-b border-white/10 bg-purple-500/10">
                    <div className="flex items-center justify-between text-xs text-purple-300 mb-1">
                        <span>Embedding document...</span>
                        <span>{embeddingProgress || 0}%</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-purple-500 rounded-full transition-all duration-300"
                            style={{ width: `${embeddingProgress || 0}%` }}
                        />
                    </div>
                    <p className="text-xs text-purple-400/70 mt-2">Please wait while the document is being processed...</p>
                </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : msg.role === "tool" ? "justify-start" : "justify-start"}`}>
                        <div className={`max-w-[85%] p-3 rounded-xl ${msg.role === "user"
                            ? "bg-purple-500/30 text-purple-100"
                            : msg.role === "tool"
                                ? "bg-yellow-500/10 border border-yellow-500/20"
                                : "bg-white/5 text-purple-100"
                            }`}>
                            {msg.role === "user" ? (() => {
                                const { mainText, attachedText } = parseMessage(msg.content);
                                return (
                                    <div>
                                        {attachedText && (
                                            <div className="mb-2 flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-500/15 rounded-lg border border-blue-500/25">
                                                <svg className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                </svg>
                                                <span className="text-xs text-blue-300 truncate">
                                                    {attachedText.length > 50 ? attachedText.substring(0, 50) + "..." : attachedText}
                                                </span>
                                            </div>
                                        )}
                                        <p className="text-sm whitespace-pre-wrap">{mainText}</p>
                                    </div>
                                );
                            })() : msg.role === "tool" ? (
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-1.5 px-2 py-1 bg-yellow-500/15 rounded-lg border border-yellow-500/25">
                                        <svg className="w-3.5 h-3.5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                        <span className="text-xs font-medium text-yellow-300">Tool</span>
                                    </div>
                                    <span className="text-sm text-yellow-200/90">{msg.content.replace('🔧 Tool: ', '')}</span>
                                </div>
                            ) : msg.role === "assistant" ? (
                                <div className="text-sm prose prose-invert prose-sm max-w-none">
                                    <ReactMarkdown
                                        components={{
                                            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                                            ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                                            ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                                            li: ({ children }) => <li className="text-purple-100">{children}</li>,
                                            code: ({ children, className }) => {
                                                const isInline = !className;
                                                return isInline ? (
                                                    <code className="bg-white/10 px-1.5 py-0.5 rounded text-purple-200 text-xs">{children}</code>
                                                ) : (
                                                    <code className={`${className} block bg-primary-900/50 p-2 rounded-lg my-2 overflow-x-auto text-xs`}>{children}</code>
                                                );
                                            },
                                            pre: ({ children }) => <pre className="bg-primary-900/50 p-3 rounded-lg my-2 overflow-x-auto text-xs">{children}</pre>,
                                            strong: ({ children }) => <strong className="text-purple-200 font-semibold">{children}</strong>,
                                            em: ({ children }) => <em className="text-purple-300">{children}</em>,
                                            a: ({ href, children }) => <a href={href} className="text-purple-300 hover:text-purple-200 underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                                            h1: ({ children }) => <h1 className="text-xl font-bold text-purple-100 mb-2">{children}</h1>,
                                            h2: ({ children }) => <h2 className="text-lg font-semibold text-purple-100 mb-1.5">{children}</h2>,
                                            h3: ({ children }) => <h3 className="text-base font-medium text-purple-100 mb-1">{children}</h3>,
                                            blockquote: ({ children }) => <blockquote className="border-l-2 border-purple-500/50 pl-3 italic text-purple-300 my-2">{children}</blockquote>,
                                            hr: () => <hr className="border-white/10 my-3" />,
                                        }}
                                    >
                                        {msg.content}
                                    </ReactMarkdown>
                                </div>
                            ) : (
                                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                            )}
                        </div>
                    </div>
                ))}

                {/* Document Recommendations */}
                {docRecommendations.length > 0 && (
                    <DocumentRecommendations
                        documents={docRecommendations}
                        onOpenDocument={onOpenDocument ?? (() => {})}
                    />
                )}

                {/* Streaming view */}
                {(streamingContent || activeTool || completedTools.length > 0) && (
                    <div className="flex flex-col gap-3">
                        {completedTools.map((tool, idx) => (
                            <div key={`tool-done-${idx}`} className="flex justify-start">
                                <div className="max-w-[85%] p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                                    <div className="flex items-center gap-2">
                                        <div className="flex items-center gap-1.5 px-2 py-1 bg-yellow-500/15 rounded-lg border border-yellow-500/25">
                                            <svg className="w-3.5 h-3.5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                            <span className="text-xs font-medium text-yellow-300">Tool</span>
                                        </div>
                                        <span className="text-sm text-yellow-200/90">{tool.name.replace('🔧 Tool: ', '')}</span>
                                    </div>
                                </div>
                            </div>
                        ))}

                        {(activeTool || streamingContent) && (
                            <div className="flex justify-start">
                                <div className="max-w-[85%] p-3 rounded-xl bg-white/5 text-purple-100">
                                    {activeTool ? (
                                        <div className="flex items-center gap-2 mb-2">
                                            <div className="flex items-center gap-1.5 px-2 py-1 bg-yellow-500/15 rounded-lg border border-yellow-500/25">
                                                <svg className="w-3.5 h-3.5 text-yellow-400 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                </svg>
                                                <span className="text-xs font-medium text-yellow-300">Using {activeTool.name}...</span>
                                            </div>
                                        </div>
                                    ) : null}

                                    {streamingContent && (
                                        <div className="text-sm prose prose-invert prose-sm max-w-none">
                                            <ReactMarkdown
                                                components={{
                                                    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                                                    ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                                                    ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                                                    li: ({ children }) => <li className="text-purple-100">{children}</li>,
                                                    code: ({ children, className }) => {
                                                        const isInline = !className;
                                                        return isInline ? (
                                                            <code className="bg-white/10 px-1.5 py-0.5 rounded text-purple-200 text-xs">{children}</code>
                                                        ) : (
                                                            <code className={`${className} block bg-primary-900/50 p-2 rounded-lg my-2 overflow-x-auto text-xs`}>{children}</code>
                                                        );
                                                    },
                                                    pre: ({ children }) => <pre className="bg-primary-900/50 p-3 rounded-lg my-2 overflow-x-auto text-xs">{children}</pre>,
                                                }}
                                            >
                                                {streamingContent}
                                            </ReactMarkdown>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {loading && !streamingContent && !activeTool && (
                    <div className="flex justify-start">
                        <div className="bg-white/5 p-3 rounded-xl">
                            <div className="animate-pulse flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-purple-400 rounded-full"></span>
                                <span className="w-1.5 h-1.5 bg-purple-400 rounded-full" style={{ animationDelay: "0.2s" }}></span>
                                <span className="w-1.5 h-1.5 bg-purple-400 rounded-full" style={{ animationDelay: "0.4s" }}></span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Scroll anchor */}
                <div ref={messagesEndRef} />
            </div>

            {/* Organize Confirmation Modal */}
            {organizePlan.length > 0 && (
                <div className="p-4 border-t border-white/10 bg-purple-500/10">
                    <div className="bg-white/5 rounded-xl p-4 border border-purple-500/30">
                        <div className="flex items-center gap-2 mb-3">
                            <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                            </svg>
                            <span className="font-medium text-purple-100">Confirm Folder Organization</span>
                            {organizePlan.length > 1 && <span className="text-xs text-purple-400/70 ml-auto">{organizePlan.length} pending</span>}
                        </div>

                        <div className="text-sm text-purple-300 mb-3">
                            <p className="mb-2">Organize <span className="text-purple-200">{organizePlan[0].targetPath}</span></p>
                            <p className="text-purple-400/70">
                                {organizePlan[0].flatten
                                    ? "Flatten: Move all files to root, remove subfolders"
                                    : `Strategy: ${organizePlan[0].strategy} (include subfolders)`
                                }
                            </p>
                            {organizePlan[0].totalFiles && (
                                <p className="text-purple-400/70 text-xs mt-1">{organizePlan[0].totalFiles} files to process</p>
                            )}
                        </div>

                        <div className="space-y-2 mb-4 max-h-40 overflow-y-auto">
                            {organizePlan[0].groups.map((group, idx) => (
                                <div key={idx} className="bg-white/5 rounded-lg p-2">
                                    <div className="flex items-center gap-2 text-purple-200 text-sm font-medium mb-1">
                                        <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                        </svg>
                                        {group.folder === "Root" ? "All files to root" : group.folder}/ ({group.files.length} files)
                                    </div>
                                    <div className="pl-6 space-y-0.5">
                                        {group.files.map((file, fIdx) => (
                                            <div key={fIdx} className="text-xs text-purple-300/70 truncate">{file}</div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={handleOrganizeCancel}
                                className="flex-1 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-purple-200 text-sm font-medium transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleOrganizeConfirm}
                                disabled={loading}
                                className="flex-1 px-4 py-2 rounded-lg bg-purple-500 hover:bg-purple-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
                            >
                                {loading ? "Organizing..." : "Confirm & Organize"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Convert Confirmation Modal */}
            {convertPlan.length > 0 && (
                <div className="p-4 border-t border-white/10 bg-emerald-500/10">
                    <div className="bg-white/5 rounded-xl p-4 border border-emerald-500/30">
                        <div className="flex items-center gap-2 mb-3">
                            <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="font-medium text-emerald-100">Confirm PowerPoint to PDF Conversion</span>
                            {convertPlan.length > 1 && <span className="text-xs text-emerald-400/70 ml-auto">{convertPlan.length} pending</span>}
                        </div>

                        <div className="text-sm text-emerald-300 mb-3">
                            <p className="mb-2">Convert <span className="text-emerald-200">{convertPlan[0].totalFiles} file(s)</span></p>
                            {convertPlan[0].totalSize && (
                                <p className="text-emerald-400/70 text-xs">
                                    Total size: {Math.round(convertPlan[0].totalSize / 1024)} KB
                                </p>
                            )}
                        </div>

                        <div className="space-y-2 mb-4 max-h-40 overflow-y-auto">
                            {convertPlan[0].files.map((file, idx) => (
                                <div key={idx} className="bg-white/5 rounded-lg p-2">
                                    <div className="flex items-center gap-2 text-emerald-200 text-sm">
                                        <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        <span className="truncate flex-1">{file.fileName}</span>
                                        <span className="text-emerald-400/70 text-xs">→ {file.outputPath.split(/[\\/]/).pop()}</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={handleConvertCancel}
                                className="flex-1 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-emerald-200 text-sm font-medium transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConvertConfirm}
                                disabled={loading}
                                className="flex-1 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
                            >
                                {loading ? "Converting..." : "Convert to PDF"}
                            </button>
                        </div>
                    </div>
                </div>
            )}


            {/* Move Confirmation Modal */}
            {movePlan.length > 0 && (
                <div className="p-4 border-t border-white/10 bg-blue-500/10">
                    <div className="bg-white/5 rounded-xl p-4 border border-blue-500/30">
                        <div className="flex items-center gap-2 mb-3">
                            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                            </svg>
                            <span className="font-medium text-blue-100">Confirm Move</span>
                            {movePlan.length > 1 && <span className="text-xs text-blue-400/70 ml-auto">{movePlan.length} pending</span>}
                        </div>
                        <div className="space-y-2 mb-4 max-h-40 overflow-y-auto">
                            {movePlan[0].moves.map((move, idx) => (
                                <div key={idx} className="bg-white/5 rounded-lg p-2 text-sm">
                                    <div className="text-blue-200 truncate">{move.fileName}</div>
                                    <div className="text-blue-400/60 text-xs truncate">→ {move.to}</div>
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <button onClick={handleMoveCancel} className="flex-1 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-blue-200 text-sm font-medium transition-colors">Cancel</button>
                            <button onClick={handleMoveConfirm} disabled={loading} className="flex-1 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors disabled:opacity-50">
                                {loading ? "Moving..." : "Confirm Move"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Rename Confirmation Modal */}
            {renamePlan.length > 0 && (
                <div className="p-4 border-t border-white/10 bg-amber-500/10">
                    <div className="bg-white/5 rounded-xl p-4 border border-amber-500/30">
                        <div className="flex items-center gap-2 mb-3">
                            <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            <span className="font-medium text-amber-100">Confirm Rename</span>
                            {renamePlan.length > 1 && <span className="text-xs text-amber-400/70 ml-auto">{renamePlan.length} pending</span>}
                        </div>
                        <div className="bg-white/5 rounded-lg p-3 mb-4 text-sm">
                            <div className="text-amber-300/70 text-xs mb-1">From</div>
                            <div className="text-amber-200 truncate">{renamePlan[0].oldName}</div>
                            <div className="text-amber-300/70 text-xs mt-2 mb-1">To</div>
                            <div className="text-amber-200 truncate">{renamePlan[0].newName}</div>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={handleRenameCancel} className="flex-1 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-amber-200 text-sm font-medium transition-colors">Cancel</button>
                            <button onClick={handleRenameConfirm} disabled={loading} className="flex-1 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium transition-colors disabled:opacity-50">
                                {loading ? "Renaming..." : "Confirm Rename"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deletePlan.length > 0 && (
                <div className="p-4 border-t border-white/10 bg-red-500/10">
                    <div className="bg-white/5 rounded-xl p-4 border border-red-500/30">
                        <div className="flex items-center gap-2 mb-3">
                            <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            <span className="font-medium text-red-100">Confirm Delete</span>
                            <span className="text-xs text-red-400/70 ml-auto">{deletePlan.length > 1 ? `${deletePlan.length} pending · ` : ""}This cannot be undone</span>
                        </div>
                        <div className="space-y-2 mb-4 max-h-40 overflow-y-auto">
                            {deletePlan[0].files.map((file, idx) => (
                                <div key={idx} className="bg-white/5 rounded-lg p-2 flex items-center gap-2">
                                    <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        {file.isDirectory
                                            ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                            : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        }
                                    </svg>
                                    <span className="text-sm text-red-200 truncate flex-1">{file.name}</span>
                                    {file.size !== undefined && (
                                        <span className="text-xs text-red-400/60 flex-shrink-0">{Math.round(file.size / 1024)} KB</span>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <button onClick={handleDeleteCancel} className="flex-1 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-red-200 text-sm font-medium transition-colors">Cancel</button>
                            <button onClick={handleDeleteConfirm} disabled={loading} className="flex-1 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50">
                                {loading ? "Deleting..." : "Delete Permanently"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Selected Text Section - positioned above input */}
            {mode === "viewer" && selectedText && (
                <div className="p-3 border-t border-white/10 bg-blue-500/10">
                    <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                            <p className="text-xs text-blue-300 mb-1">Selected text:</p>
                            <p className="text-sm text-purple-100 truncate">{selectedText.length > 60 ? selectedText.substring(0, 60) + "..." : selectedText}</p>
                        </div>
                        {onClearSelection && (
                            <button
                                onClick={onClearSelection}
                                className="p-1 rounded hover:bg-white/10 text-purple-400 flex-shrink-0"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Input */}
            <ChatInput
                onSubmit={handleSubmit}
                placeholder={mode === "explorer" ? "Ask to navigate or find files..." : "Ask about the document..."}
                disabled={loading}
            />
        </div>
    );
}
