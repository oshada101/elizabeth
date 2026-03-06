import React, { useState, useCallback } from "react";

interface FileEntry {
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    modified: string;
}

interface AIAssistantProps {
    currentPath: string;
    onNavigate: (path: string) => void;
    onFileSelect: (file: FileEntry) => void;
}

interface Message {
    role: "user" | "assistant";
    content: string;
}

export default function AIAssistant({ currentPath, onNavigate, onFileSelect }: AIAssistantProps) {
    const [messages, setMessages] = useState<Message[]>([
        { role: "assistant", content: "Hi! I can help you navigate files and find content. Try commands like:\n\n• \"show me PDFs in this folder\"\n• \"list all files\"\n• \"go to Documents\"\n• \"find files containing...\"\n• \"what's in this directory\"" }
    ]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);

    const handleCommand = useCallback(async (cmd: string) => {
        setLoading(true);
        const lowerCmd = cmd.toLowerCase().trim();

        try {
            const files = await window.electronAPI.fs.readDir(currentPath);
            if (!files) {
                setMessages(prev => [...prev, { role: "assistant", content: "Error reading directory." }]);
                return;
            }

            let response = "";

            if (lowerCmd.includes("show") && (lowerCmd.includes("pdf") || lowerCmd.includes("document"))) {
                const pdfs = files.filter(f => f.name.toLowerCase().endsWith(".pdf"));
                if (pdfs.length === 0) {
                    response = "No PDF files found in this directory.";
                } else {
                    response = `Found ${pdfs.length} PDF file(s):\n\n` + pdfs.map(f => `• ${f.name}`).join("\n");
                }
            } else if (lowerCmd.includes("list") || lowerCmd.includes("what") && lowerCmd.includes("directory") || lowerCmd.includes("what's") && lowerCmd.includes("in")) {
                const dirs = files.filter(f => f.isDirectory);
                const pdfs = files.filter(f => f.name.toLowerCase().endsWith(".pdf"));
                const txts = files.filter(f => f.name.match(/\.(txt|md)$/i));
                const others = files.filter(f => !f.isDirectory && !f.name.match(/\.(pdf|txt|md)$/i));

                response = `Contents of ${currentPath.split(/[/\\]/).pop()}:\n\n`;
                if (dirs.length > 0) response += `📁 Folders (${dirs.length}):\n${dirs.slice(0, 5).map(f => `  • ${f.name}`).join("\n")}${dirs.length > 5 ? `\n  ...and ${dirs.length - 5} more` : ""}\n\n`;
                if (pdfs.length > 0) response += `📄 PDFs (${pdfs.length}):\n${pdfs.slice(0, 5).map(f => `  • ${f.name}`).join("\n")}${pdfs.length > 5 ? `\n  ...and ${pdfs.length - 5} more` : ""}\n\n`;
                if (txts.length > 0) response += `📝 Text files (${txts.length}):\n${txts.slice(0, 5).map(f => `  • ${f.name}`).join("\n")}${txts.length > 5 ? `\n  ...and ${txts.length - 5} more` : ""}\n\n`;
                if (others.length > 0) response += `📎 Other files (${others.length})`;
            } else if (lowerCmd.startsWith("go to ") || lowerCmd.startsWith("cd ")) {
                const target = lowerCmd.replace(/^(go to |cd )/, "").trim();
                const matched = files.filter(f => f.isDirectory && f.name.toLowerCase().includes(target));
                if (matched.length > 0) {
                    response = `Navigating to ${matched[0].name}...`;
                    onNavigate(matched[0].path);
                } else {
                    response = `Folder "${target}" not found in current directory.`;
                }
            } else if (lowerCmd.includes("find") && lowerCmd.includes("contain")) {
                response = "Searching file contents is not yet supported. I can help you find files by name though!";
            } else if (lowerCmd.includes("open ") || lowerCmd.includes("show ") && files.some(f => f.name.toLowerCase().includes(lowerCmd.replace(/^(open |show )/, "").trim()))) {
                const target = lowerCmd.replace(/^(open |show )/, "").trim();
                const matched = files.find(f => f.name.toLowerCase().includes(target));
                if (matched) {
                    if (matched.isDirectory) {
                        response = `Opening folder: ${matched.name}...`;
                        onNavigate(matched.path);
                    } else {
                        response = `Opening file: ${matched.name}`;
                        onFileSelect(matched);
                    }
                } else {
                    response = `File "${target}" not found.`;
                }
            } else if (lowerCmd === "home" || lowerCmd === "go home") {
                const home = await window.electronAPI.fs.getHomeDir();
                response = "Going to home directory...";
                onNavigate(home);
            } else if (lowerCmd === "parent" || lowerCmd === "go up" || lowerCmd === "..") {
                const parent = await window.electronAPI.fs.getParentDir(currentPath);
                if (parent) {
                    response = "Going to parent directory...";
                    onNavigate(parent);
                } else {
                    response = "Already at root directory.";
                }
            } else {
                response = `I didn't understand that command. Try:\n\n• "show PDFs in this folder"\n• "list all files"\n• "go to Documents"\n• "open filename.pdf"\n• "home" or "parent"`;
            }

            setMessages(prev => [...prev, { role: "assistant", content: response }]);
        } catch (error) {
            setMessages(prev => [...prev, { role: "assistant", content: "Error processing command." }]);
        } finally {
            setLoading(false);
        }
    }, [currentPath, onNavigate, onFileSelect]);

    const handleSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || loading) return;

        setMessages(prev => [...prev, { role: "user", content: input }]);
        handleCommand(input);
        setInput("");
    }, [input, loading, handleCommand]);

    return (
        <div className="flex flex-col h-full bg-primary-950">
            <div className="p-4 border-b border-white/10">
                <h3 className="text-lg font-semibold text-purple-200">AI Assistant</h3>
                <p className="text-xs text-purple-400/70 mt-1">File navigation help</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[85%] p-3 rounded-xl ${
                            msg.role === "user" 
                                ? "bg-purple-500/30 text-purple-100" 
                                : "bg-white/5 text-purple-100"
                        }`}>
                            <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
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

            <form onSubmit={handleSubmit} className="p-4 border-t border-white/10">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Ask to navigate or find files..."
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
