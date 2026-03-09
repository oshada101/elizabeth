import React, { useState, useEffect, useCallback, useMemo, memo } from "react";
import ReactMarkdown from "react-markdown";
import ChatInput from "./ChatInput";

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

export default function UnifiedPanel({ currentPath, onNavigate, onFileSelect, mode, sessionId, onBack, selectedText, onClearSelection, isEmbedding, embeddingProgress, onNewSession, onSessionChange, onDeleteSession }: UnifiedPanelProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(false);

    // Streaming state
    const [streamingContent, setStreamingContent] = useState("");
    const [activeTool, setActiveTool] = useState<{ name: string, input?: any } | null>(null);
    const [completedTools, setCompletedTools] = useState<{ name: string, output?: any }[]>([]);

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
            }
        });

        return () => {
            removeChunkListener();
            removeToolListener();
        };
    }, []);

    useEffect(() => {
        if (sessionId) {
            loadMessages();
        }
    }, [sessionId]);

    const loadMessages = async () => {
        if (!sessionId) return 0;
        const msgs = await window.electronAPI.getMessages(sessionId);
        if (msgs.length === 0) {
            setMessages([
                { role: "assistant", content: "Hi! I'm your AI assistant. I can help you navigate files or answer questions about your documents. Ask me anything!" }
            ]);
        } else {
            const sanitizedMsgs = msgs.map((msg: any) => ({
                ...msg,
                role: msg.role as 'user' | 'assistant' | 'tool',
                content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
            }));
            setMessages(sanitizedMsgs);
        }
        return msgs.length;
    };


    const parseMessage = (content: string): { mainText: string; attachedText: string | null } => {
        let mainText = content;
        const contextMatch = mainText.match(/^\[System Context: .*?\]\n([\s\S]*)$/);
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
        const prefix = `[System Context: User is currently in ${contextStr} mode]\n`;

        const fullMessage = selectedText
            ? `${prefix}[[TEXT:${selectedText}]]\n${userInput}`
            : `${prefix}${userInput}`;

        if (onClearSelection) onClearSelection();
        setLoading(true);

        if (sessionId) {
            window.electronAPI.addMessage(sessionId, "user", fullMessage).then(async () => {
                const msgCountBefore = await loadMessages();
                window.electronAPI.ask(fullMessage, sessionId, currentPath).then(async (response) => {
                    // Once ask resolves, save final messages to DB
                    if (response && Array.isArray(response.messages) && response.messages.length > 0) {
                        const newMessages = response.messages.slice(msgCountBefore);
                        for (const msg of newMessages) {
                            const role = msg.type === 'tool' ? 'tool' : 'assistant';
                            let content: string;
                            if (msg.type === 'tool') {
                                content = typeof msg.name === 'string' ? msg.name : JSON.stringify(msg.name);
                            } else {
                                content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                            }
                            await window.electronAPI.addMessage(sessionId, role, content);
                        }
                    } else {
                        await window.electronAPI.addMessage(sessionId, 'assistant', 'No response available.');
                    }
                    setStreamingContent("");
                    setActiveTool(null);
                    setCompletedTools([]);
                    await loadMessages();
                    setLoading(false);
                }).catch(async (err) => {
                    await window.electronAPI.addMessage(sessionId, 'assistant', 'Error: ' + (err?.message || "Unknown error"));
                    setStreamingContent("");
                    setActiveTool(null);
                    setCompletedTools([]);
                    await loadMessages();
                    setLoading(false);
                });
            }).catch(async (err) => {
                await window.electronAPI.addMessage(sessionId, 'assistant', 'Error: ' + (err?.message || "Failed to send message"));
                await loadMessages();
                setLoading(false);
            });
        } else {
            setMessages(prev => [...prev, { role: "assistant", content: "No active session." }]);
            setLoading(false);
        }
    }, [loading, mode, sessionId, selectedText, onClearSelection, currentPath]);

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
            </div>


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
