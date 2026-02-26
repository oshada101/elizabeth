import { useState, useEffect, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import React from "react";

interface OutlineItem {
    title: string;
    pageNum: number;
    items: OutlineItem[];
}

interface TOCPanelProps {
    pdf: pdfjsLib.PDFDocumentProxy | null;
    onNavigate: (pageNum: number) => void;
    currentPage: number;
}

function TOCPanel({ pdf, onNavigate, currentPage }: TOCPanelProps) {
    const [outline, setOutline] = useState<OutlineItem[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

    const resolveOutline = useCallback(
        async (
            items: any[],
            pdfDoc: pdfjsLib.PDFDocumentProxy,
        ): Promise<OutlineItem[]> => {
            const resolved: OutlineItem[] = [];
            for (const item of items) {
                let pageNum = 1;
                try {
                    if (typeof item.dest === "string") {
                        const dest = await pdfDoc.getDestination(item.dest);
                        if (dest) {
                            const ref = dest[0];
                            const pageIndex = await pdfDoc.getPageIndex(ref);
                            pageNum = pageIndex + 1;
                        }
                    } else if (Array.isArray(item.dest) && item.dest.length > 0) {
                        const ref = item.dest[0];
                        const pageIndex = await pdfDoc.getPageIndex(ref);
                        pageNum = pageIndex + 1;
                    }
                } catch {
                    // fallback to page 1
                }
                const children =
                    item.items && item.items.length > 0
                        ? await resolveOutline(item.items, pdfDoc)
                        : [];
                resolved.push({
                    title: item.title,
                    pageNum,
                    items: children,
                });
            }
            return resolved;
        },
        [],
    );

    useEffect(() => {
        if (!pdf) {
            setOutline(null);
            return;
        }
        setLoading(true);
        pdf.getOutline()
            .then(async (rawOutline) => {
                if (!rawOutline || rawOutline.length === 0) {
                    setOutline([]);
                    setLoading(false);
                    return;
                }
                const resolved = await resolveOutline(rawOutline, pdf);
                setOutline(resolved);
                setLoading(false);
            })
            .catch((err) => {
                console.warn("Error loading outline:", err);
                setOutline([]);
                setLoading(false);
            });
    }, [pdf, resolveOutline]);

    const toggleExpand = useCallback((key: string) => {
        setExpandedItems((prev) => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }, []);

    const renderItems = (items: OutlineItem[], depth: number = 0, parentKey: string = "") => {
        return items.map((item, index) => {
            const key = `${parentKey}-${index}`;
            const hasChildren = item.items.length > 0;
            const isExpanded = expandedItems.has(key);
            const isActive = item.pageNum === currentPage;

            return (
                <div key={key}>
                    <div
                        className={`group flex items-center gap-1.5 py-1.5 px-2 rounded-lg cursor-pointer transition-all duration-200
                            ${isActive
                                ? "bg-purple-500/20 text-purple-200"
                                : "text-primary-300 hover:bg-white/5 hover:text-primary-100"
                            }`}
                        style={{ paddingLeft: `${depth * 14 + 8}px` }}
                        onClick={() => onNavigate(item.pageNum)}
                    >
                        {hasChildren && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    toggleExpand(key);
                                }}
                                className="p-0.5 rounded hover:bg-white/10 transition-all duration-200 flex-shrink-0"
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className={`h-3 w-3 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                >
                                    <path
                                        fillRule="evenodd"
                                        d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                                        clipRule="evenodd"
                                    />
                                </svg>
                            </button>
                        )}
                        {!hasChildren && <span className="w-4 flex-shrink-0" />}
                        <span className="text-sm truncate flex-1" title={item.title}>
                            {item.title}
                        </span>
                        <span className="text-xs text-primary-400/60 opacity-0 group-hover:opacity-100 transition-opacity tabular-nums flex-shrink-0">
                            {item.pageNum}
                        </span>
                    </div>
                    {hasChildren && isExpanded && (
                        <div className="animate-fade-in">
                            {renderItems(item.items, depth + 1, key)}
                        </div>
                    )}
                </div>
            );
        });
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="glass-header flex items-center px-4 py-3">
                <h2 className="text-sm font-semibold text-primary-200 tracking-tight uppercase">
                    Table of Contents
                </h2>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-2">
                {loading ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary-500/30 border-t-primary-400" />
                    </div>
                ) : outline === null || !pdf ? (
                    <div className="flex items-center justify-center h-full text-primary-400/60 text-sm">
                        Open a PDF to view outline
                    </div>
                ) : outline.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-primary-400/60 gap-2">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-8 w-8 opacity-40"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.5}
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                            />
                        </svg>
                        <span className="text-sm">No table of contents available</span>
                    </div>
                ) : (
                    renderItems(outline)
                )}
            </div>
        </div>
    );
}

export default TOCPanel;
