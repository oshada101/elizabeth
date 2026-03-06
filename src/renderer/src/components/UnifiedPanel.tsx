import React, { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";

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
}

interface Message {
    role: "user" | "assistant" | "tool";
    content: string;
}

export default function UnifiedPanel({ currentPath, onNavigate, onFileSelect, mode, sessionId, onBack, selectedText, onClearSelection, isEmbedding, embeddingProgress }: UnifiedPanelProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);

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

        const match = mainText.match(/^\[\[TEXT:(.+)\]\]\n([\s\S]*)$/);
        if (match) {
            return { mainText: match[2], attachedText: match[1] };
        }
        return { mainText, attachedText: null };
    };

    const handleSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || loading) return;

        const userInput = input;
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
                window.electronAPI.ask(fullMessage, sessionId).then(async (response) => {
                    if (response && Array.isArray(response.messages) && response.messages.length > 0) {
                        // Get only new messages (after what we had before)
                        const newMessages = response.messages.slice(msgCountBefore);
                        console.log(response)
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
                        await loadMessages();
                    } else {
                        await window.electronAPI.addMessage(sessionId, 'assistant', 'No response available.');
                        await loadMessages();
                    }
                    setLoading(false);
                }).catch(async (err) => {
                    await window.electronAPI.addMessage(sessionId, 'assistant', 'Error: ' + (err?.message || "Unknown error"));
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

        setInput("");
    }, [input, loading, mode, sessionId, selectedText, onClearSelection]);

    return (
        <div className="flex flex-col h-full bg-primary-950">
            {/* Context indicator */}
            <div className="p-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 text-xs rounded-full ${mode === "explorer" ? "bg-purple-500/30 text-purple-200" : "bg-blue-500/30 text-blue-200"}`}>
                        {mode === "explorer" ? "📁 File Navigation" : "📄 Document Chat"}
                    </span>
                    {mode === "viewer" && onBack && (
                        <button
                            onClick={onBack}
                            className="ml-auto px-2 py-1 text-xs bg-white/10 hover:bg-white/20 text-purple-200 rounded-lg transition-colors"
                        >
                            ← Back
                        </button>
                    )}
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
                {loading && (
                    <div className="flex justify-start">
                        <div className="bg-white/5 p-3 rounded-xl">
                            <div className="animate-pulse text-purple-300 text-sm">Processing...</div>
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
            <form onSubmit={handleSubmit} className="p-4 border-t border-white/10">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={mode === "explorer" ? "Ask to navigate or find files..." : "Ask about the document..."}
                        className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-purple-300/50 focus:outline-none focus:border-purple-500/50"
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || loading}
                        className="px-4 py-2 bg-purple-500/30 hover:bg-purple-500/50 text-purple-200 rounded-xl transition-colors disabled:opacity-50"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                    </button>
                </div>
            </form>
        </div>
    );
}
