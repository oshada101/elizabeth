import React, { useState, useEffect } from "react";
import PDFViewer from "./PDFViewer";

interface FileViewerProps {
    file: {
        name: string;
        path: string;
        isDirectory: boolean;
        size: number;
        modified: string;
    } | null;
    onClose: () => void;
}

export default function FileViewer({ file, onClose }: FileViewerProps) {
    const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
    const [textContent, setTextContent] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!file || file.isDirectory) {
            setPdfData(null);
            setTextContent(null);
            return;
        }

        const loadFile = async () => {
            setLoading(true);
            setError(null);
            setPdfData(null);
            setTextContent(null);

            try {
                const buffer = await window.electronAPI.readFile(file.path);
                if (!buffer) {
                    setError("Failed to read file");
                    return;
                }

                const ext = file.name.split(".").pop()?.toLowerCase();

                if (ext === "pdf") {
                    setPdfData(new Uint8Array(buffer));
                } else if (ext === "txt" || ext === "md") {
                    const decoder = new TextDecoder("utf-8");
                    setTextContent(decoder.decode(buffer));
                } else {
                    setError(`Unsupported file type: ${ext}`);
                }
            } catch (err) {
                setError("Error loading file");
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        loadFile();
    }, [file]);

    if (!file) return null;

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-primary-950 rounded-2xl w-full max-w-6xl h-[90vh] flex flex-col border border-white/10 shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                    <div className="flex items-center gap-3">
                        <svg className="w-6 h-6 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                        </svg>
                        <h2 className="text-lg font-semibold text-white truncate max-w-md">
                            {file.name}
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-white/10 text-purple-300 hover:text-white transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden">
                    {loading ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-400"></div>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center h-full text-purple-300">
                            <svg className="w-16 h-16 mb-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <p>{error}</p>
                        </div>
                    ) : pdfData ? (
                        <PDFViewer pdfData={pdfData} />
                    ) : textContent ? (
                        <div className="h-full overflow-auto p-6 bg-primary-900/50">
                            <pre className="text-sm text-purple-100 whitespace-pre-wrap font-mono">
                                {textContent}
                            </pre>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
