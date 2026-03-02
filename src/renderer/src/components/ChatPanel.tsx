import { useState, useEffect, useRef, useCallback } from "react";
import type { Message } from "../App";
import React from "react";
import ReactMarkdown from "react-markdown";

interface ChatPanelProps {
    sessionId: number | null;
    selectedText: string | null;
    onClearSelection: () => void;
}

function ChatPanel({
    sessionId,
    selectedText,
    onClearSelection,
}: ChatPanelProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        if (sessionId) {
            loadMessages();
        }
    }, [sessionId]);

    const loadMessages = async () => {
        if (!sessionId) return;
        const msgs = await window.electronAPI.getMessages(sessionId);
        setMessages(msgs);
    };

    const handleSendMessage = useCallback(async () => {
        if (!inputValue.trim() || !sessionId) return;

        const userMessage = inputValue.trim();
        const fullMessage = selectedText
            ? `[[TEXT:${selectedText}]]\n${userMessage}`
            : userMessage;

        setInputValue("");
        onClearSelection();

        await window.electronAPI.addMessage(sessionId, "user", fullMessage);
        await loadMessages();

        setIsTyping(true);
        const response = await window.electronAPI.ask(fullMessage, sessionId!);
        setIsTyping(false);

        console.log("Full response:", JSON.stringify(response, null, 2));

        // Only get messages WITHOUT tool calls (the real answers)
        const answers = response.messages
            .filter(
                (m: any) =>
                    m.type === "ai" &&
                    (!m.tool_calls || m.tool_calls.length === 0),
            )
            .map((m: any) => m.content);

        console.log("Clean answers:", answers);
        // Output: ["The weather in Los Angeles is always sunny! It's a great day to be outdoors in LA."]

        // Add to message system
        for (const answer of answers) {
            await window.electronAPI.addMessage(sessionId, "assistant", answer);
        }
        await loadMessages();
    }, [inputValue, sessionId, selectedText, onClearSelection]);

    const parseMessage = (
        content: string,
    ): { mainText: string; attachedText: string | null } => {
        const match = content.match(/^\[\[TEXT:(.+)\]\]\n(.*)$/s);
        if (match) {
            return {
                mainText: match[2],
                attachedText: match[1],
            };
        }
        return { mainText: content, attachedText: null };
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const handleClearChat = async () => {
        if (sessionId) {
            await window.electronAPI.clearMessages(sessionId);
            setMessages([]);
        }
    };

    const formatTime = (timestamp: string) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    return (
        <div className="flex flex-col h-full bg-transparent">
            {/* ── Glass Header ── */}
            <div className="glass-header flex items-center justify-between px-5 py-3">
                <h2 className="text-base font-semibold text-primary-200 tracking-tight">
                    Chat Assistant
                </h2>
                <button
                    onClick={handleClearChat}
                    className="p-2 rounded-xl bg-white/5 border border-white/8 text-primary-300 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20 hover:scale-105 active:scale-95 transition-all duration-200"
                    title="Clear chat"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-4 w-4"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                    >
                        <path
                            fillRule="evenodd"
                            d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                            clipRule="evenodd"
                        />
                    </svg>
                </button>
            </div>

            {/* ── Messages Area ── */}
            <div className="flex-1 overflow-auto p-4 space-y-4">
                {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-primary-400 animate-fade-in">
                        <div className="p-4 rounded-2xl bg-primary-800/15 mb-4">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-14 w-14"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={1.5}
                                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                                />
                            </svg>
                        </div>
                        <p className="text-base font-medium text-primary-200">
                            Start a conversation
                        </p>
                        <p className="text-sm text-primary-400/70 mt-1">
                            Ask me anything about your PDF
                        </p>
                    </div>
                ) : (
                    messages.map((msg) => {
                        const { mainText, attachedText } = parseMessage(
                            msg.content,
                        );
                        return (
                            <div
                                key={msg.id}
                                className={`flex animate-fade-in ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                            >
                                <div className="max-w-[80%]">
                                    {attachedText && (
                                        <div
                                            className={`mb-1.5 px-3 py-1.5 rounded-xl text-xs backdrop-blur-sm ${
                                                msg.role === "user"
                                                    ? "bg-primary-500/15 text-primary-200 border border-primary-500/15"
                                                    : "bg-white/5 text-primary-300 border border-white/8"
                                            }`}
                                        >
                                            <span className="font-medium">
                                                📎 Attached:{" "}
                                            </span>
                                            {attachedText.length > 50
                                                ? attachedText.substring(
                                                      0,
                                                      50,
                                                  ) + "..."
                                                : attachedText}
                                        </div>
                                    )}
                                    <div
                                        className={`rounded-2xl px-4 py-2.5 shadow-glass-sm ${
                                            msg.role === "user"
                                                ? "bg-primary-600/70 backdrop-blur-sm text-white rounded-br-lg border border-primary-500/20"
                                                : "bg-white/8 backdrop-blur-sm text-primary-100 rounded-bl-lg border border-white/8"
                                        }`}
                                    >
                                        {msg.role === "assistant" ? (
                                            <div className="text-sm leading-relaxed prose prose-invert prose-sm max-w-none">
                                                <ReactMarkdown
                                                    components={{
                                                        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                                                        ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                                                        ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                                                        li: ({ children }) => <li className="text-primary-100">{children}</li>,
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
                                                        em: ({ children }) => <em className="text-primary-200">{children}</em>,
                                                        a: ({ href, children }) => <a href={href} className="text-purple-300 hover:text-purple-200 underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                                                        h1: ({ children }) => <h1 className="text-xl font-bold text-purple-100 mb-2">{children}</h1>,
                                                        h2: ({ children }) => <h2 className="text-lg font-semibold text-purple-100 mb-1.5">{children}</h2>,
                                                        h3: ({ children }) => <h3 className="text-base font-medium text-purple-100 mb-1">{children}</h3>,
                                                        blockquote: ({ children }) => <blockquote className="border-l-2 border-purple-500/50 pl-3 italic text-primary-300 my-2">{children}</blockquote>,
                                                        hr: () => <hr className="border-white/10 my-3" />,
                                                    }}
                                                >
                                                    {mainText}
                                                </ReactMarkdown>
                                            </div>
                                        ) : (
                                            <p className="whitespace-pre-wrap text-sm leading-relaxed">
                                                {mainText}
                                            </p>
                                        )}
                                        <p
                                            className={`text-[11px] mt-1.5 ${msg.role === "user" ? "text-primary-200/60" : "text-primary-400/60"}`}
                                        >
                                            {formatTime(msg.timestamp)}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}

                {isTyping && (
                    <div className="flex justify-start animate-fade-in">
                        <div className="bg-white/8 backdrop-blur-sm rounded-2xl rounded-bl-lg px-4 py-3 border border-white/8 shadow-glass-sm">
                            <div className="flex space-x-1.5">
                                <div
                                    className="w-2 h-2 bg-primary-400/70 rounded-full animate-bounce"
                                    style={{ animationDelay: "0ms" }}
                                ></div>
                                <div
                                    className="w-2 h-2 bg-primary-400/70 rounded-full animate-bounce"
                                    style={{ animationDelay: "150ms" }}
                                ></div>
                                <div
                                    className="w-2 h-2 bg-primary-400/70 rounded-full animate-bounce"
                                    style={{ animationDelay: "300ms" }}
                                ></div>
                            </div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* ── Selected Text Badge ── */}
            {selectedText && (
                <div className="px-4 py-2.5 bg-primary-800/20 backdrop-blur-sm border-t border-white/5">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-primary-500/12 rounded-lg border border-primary-500/20">
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-3.5 w-3.5 text-primary-400"
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                >
                                    <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                                </svg>
                                <span className="text-xs text-primary-300/80 font-medium">
                                    Selected
                                </span>
                            </div>
                            <span className="text-sm text-primary-300/70 truncate">
                                {selectedText.length > 40
                                    ? selectedText.substring(0, 40) + "..."
                                    : selectedText}
                            </span>
                        </div>
                        <button
                            onClick={onClearSelection}
                            className="p-1.5 text-primary-300 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95 flex-shrink-0"
                            title="Deselect"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-4 w-4"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                            >
                                <path
                                    fillRule="evenodd"
                                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                    clipRule="evenodd"
                                />
                            </svg>
                        </button>
                    </div>
                </div>
            )}

            {/* ── Glass Input Area ── */}
            <div className="p-4 glass-header">
                <div className="flex gap-2.5">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Type your message..."
                        className="flex-1 glass-input text-white text-sm placeholder-primary-400/50 rounded-2xl px-4 py-3 focus:outline-none"
                    />
                    <button
                        onClick={handleSendMessage}
                        disabled={!inputValue.trim()}
                        className="glass-button p-3 text-white rounded-2xl disabled:opacity-30"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-5 w-5"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                        >
                            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ChatPanel;
