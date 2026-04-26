import React from "react";

export interface DocumentSuggestion {
    id: string;
    file_name: string;
    file_path: string;
    snippet: string;
}

interface DocumentRecommendationsProps {
    documents: DocumentSuggestion[];
    onOpenDocument: (filePath: string, fileName: string) => void;
}

export default function DocumentRecommendations({ documents, onOpenDocument }: DocumentRecommendationsProps) {
    if (!documents || documents.length === 0) {
        return null;
    }

    const getFileIcon = (fileName: string): string => {
        const ext = fileName.split(".").pop()?.toLowerCase();
        if (ext === "pdf") return "📄";
        if (["doc", "docx"].includes(ext) || ext === "md" || ext === "txt") return "📝";
        if (["xlsx", "xls", "csv"].includes(ext)) return "📊";
        return "📄";
    };

    return (
        <div className="my-4">
            <div className="flex items-center gap-2 mb-3">
                <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="text-xs font-medium text-indigo-300">Relevant Documents</span>
            </div>

            <div className="flex gap-3 overflow-x-auto pb-2">
                {documents.map((doc, idx) => (
                    <button
                        key={idx}
                        onClick={() => onOpenDocument(doc.file_path, doc.file_name)}
                        className="flex-shrink-0 w-56 p-3 rounded-xl bg-white/5 hover:bg-indigo-500/10 border border-indigo-500/20 hover:border-indigo-400/40 transition-all duration-200 text-left group"
                    >
                        <div className="flex items-start gap-2 mb-2">
                            <span className="text-lg flex-shrink-0">{getFileIcon(doc.file_name)}</span>
                            <span className="text-sm font-medium text-purple-100 truncate group-hover:text-indigo-200 transition-colors">
                                {doc.file_name}
                            </span>
                        </div>
                        {doc.snippet && (
                            <p className="text-xs text-purple-400/70 line-clamp-2">
                                {doc.snippet.length > 100 ? doc.snippet.substring(0, 100) + "..." : doc.snippet}
                            </p>
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
}