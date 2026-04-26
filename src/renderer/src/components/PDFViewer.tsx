import { useState, useRef, useEffect, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import React from "react";

pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface PDFViewerProps {
    pdfData: Uint8Array | null;
    onFileOpen?: () => void;
    onFileDrop?: (file: File) => void;
    onTextSelect?: (text: string) => void;
    fileName?: string;
    navigateToPage?: number;
    onPageChange?: (page: number) => void;
    onPdfLoad?: (pdf: pdfjsLib.PDFDocumentProxy) => void;
}

function PDFViewer({
    pdfData,
    onFileOpen,
    onFileDrop,
    onTextSelect,
    fileName,
    navigateToPage,
    onPageChange,
    onPdfLoad,
}: PDFViewerProps) {
    const ZOOM_STEP = 0.03; // Much smaller steps
    const ZOOM_SENSITIVITY = 1; // Adjust this (0.1 = slow, 1 = normal, 2 = fast)
    const containerRef = useRef<HTMLDivElement>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const pageContainerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
    const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
    const [totalPages, setTotalPages] = useState(0);
    const [scale, setScale] = useState(1.2);
    const [isDragging, setIsDragging] = useState(false);
    const [loading, setLoading] = useState(false);
    const [pageHeights, setPageHeights] = useState<Map<number, number>>(
        new Map(),
    );
    const [loadedPages, setLoadedPages] = useState<Set<number>>(new Set([1]));
    const [visiblePage, setVisiblePage] = useState(1);
    const [pdfInfo, setPdfInfo] = useState<any>(null);
    const [pageInput, setPageInput] = useState("1");
    const isInitialMount = useRef(true);

    const renderPage = useCallback(
        (pageNum: number) => {
            if (!pdf) return;

            const container = pageContainerRefs.current.get(pageNum);
            if (!container) return;

            const existingCanvas = container.querySelector("canvas");
            if (existingCanvas) return;

            pdf.getPage(pageNum).then(async (page) => {
                const viewport = page.getViewport({ scale });

                const canvas = document.createElement("canvas");
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                canvas.className = "block";

                const textLayerDiv = document.createElement("div");
                textLayerDiv.className =
                    "textLayer absolute top-0 left-0 select-text overflow-hidden";
                textLayerDiv.style.left = "0";
                textLayerDiv.style.top = "0";
                textLayerDiv.style.right = "0";
                textLayerDiv.style.bottom = "0";
                textLayerDiv.style.position = "absolute";
                textLayerDiv.style.setProperty(
                    "--scale-factor",
                    scale.toString(),
                );

                container.appendChild(canvas);
                container.appendChild(textLayerDiv);

                const context = canvas.getContext("2d")!;
                await page.render({
                    canvasContext: context,
                    viewport: viewport,
                }).promise;

                const textContent = await page.getTextContent();
                try {
                    const textLayer = new TextLayer({
                        textContentSource: textContent,
                        container: textLayerDiv,
                        viewport: viewport,
                    });
                    await textLayer.render();
                } catch (err) {
                    console.warn("Text layer rendering failed:", err);
                }
            });
        },
        [pdf, scale],
    );

    const unloadPage = useCallback((pageNum: number) => {
        const container = pageContainerRefs.current.get(pageNum);
        if (!container) return;
        container.innerHTML = "";
    }, []);

useEffect(() => {
        if (pdfData) {
            setLoading(true);
            setLoadedPages(new Set([1]));
            setPageHeights(new Map());
            setVisiblePage(1);
            const loadingTask = pdfjsLib.getDocument({ data: pdfData.slice() });
            loadingTask.promise
                .then(async (pdfDoc) => {
                    setPdf(pdfDoc);
                    setTotalPages(pdfDoc.numPages);

                    if (onPdfLoad) {
                        onPdfLoad(pdfDoc);
                    }

                    try {
                        const { info } = await pdfDoc.getMetadata();
                        setPdfInfo(info);
                    } catch (err) {
                        console.warn("Error fetching metadata:", err);
                    }

                    const heights = new Map<number, number>();
                    for (let i = 1; i <= pdfDoc.numPages; i++) {
                        const page = await pdfDoc.getPage(i);
                        const viewport = page.getViewport({ scale });
                        heights.set(i, viewport.height);
                    }
                    setPageHeights(heights);
                    setLoading(false);
                })
                .catch((err) => {
                    console.error("Error loading PDF:", err);
                    setLoading(false);
                });
        }
    }, [pdfData, onPdfLoad]);

    useEffect(() => {
        if (!pdf || totalPages === 0 || pageHeights.size === 0) return;

        const container = containerRef.current;
        if (!container) return;

        observerRef.current?.disconnect();

        observerRef.current = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    const pageNum = parseInt(
                        entry.target.getAttribute("data-page-num") || "0",
                        10,
                    );
                    if (!pageNum) return;

                    if (entry.isIntersecting) {
                        setLoadedPages((prev) => {
                            if (prev.has(pageNum)) return prev;
                            const next = new Set(prev);
                            next.add(pageNum);
                            return next;
                        });
                        setVisiblePage(pageNum);
                        setPageInput(pageNum.toString());
                        if (onPageChange) {
                            onPageChange(pageNum);
                        }
                    }
                });
            },
            { root: container, rootMargin: "200px" },
        );

        const pageElements = container.querySelectorAll("[data-page-num]");
        pageElements.forEach((el) => observerRef.current?.observe(el));

        return () => observerRef.current?.disconnect();
    }, [pdf, totalPages, pageHeights.size]);

    const scrollToPage = useCallback((pageNum: number) => {
        const container = containerRef.current;
        if (!container) return;
        
        const pageElement = container.querySelector(`[data-page-num="${pageNum}"]`) as HTMLElement;
        if (pageElement) {
            pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, []);

    useEffect(() => {
        if (!navigateToPage || !totalPages) return;
        if (isInitialMount.current) return;
        if (navigateToPage !== visiblePage && navigateToPage > 0 && navigateToPage <= totalPages) {
            scrollToPage(navigateToPage);
        }
    }, [navigateToPage, totalPages, visiblePage, scrollToPage]);

    useEffect(() => {
        isInitialMount.current = false;
    }, []);

    useEffect(() => {
        if (!pdf || totalPages === 0) return;

        const updatePageHeights = async () => {
            const heights = new Map<number, number>();
            for (let i = 1; i <= totalPages; i++) {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale });
                heights.set(i, viewport.height);
            }
            setPageHeights(heights);
        };

        updatePageHeights();
    }, [pdf, totalPages, scale]);

    useEffect(() => {
        loadedPages.forEach((pageNum) => {
            renderPage(pageNum);
        });
    }, [loadedPages, renderPage]);

    useEffect(() => {
        setLoadedPages((prev) => {
            const next = new Set(prev);
            prev.forEach((pageNum) => {
                if (Math.abs(pageNum - visiblePage) > 5) {
                    next.delete(pageNum);
                    unloadPage(pageNum);
                }
            });
            return next;
        });
    }, [visiblePage, unloadPage]);

    const handleMouseUp = useCallback(() => {
        setTimeout(() => {
            const selection = window.getSelection();
            const selectedText = selection?.toString().trim() || "";

            if (selectedText.length > 0 && onTextSelect) {
                onTextSelect(selectedText);
            }
        }, 10);
    }, [onTextSelect]);

    const handleZoomIn = () => {
        setScale((s) => Math.min(4, s + 0.2));
    };
    const handleZoomOut = () => {
        setScale((s) => Math.max(0.4, s - 0.2));
    };

    const handlePrevPage = useCallback(() => {
        if (visiblePage > 1) {
            const newPage = visiblePage - 1;
            scrollToPage(newPage);
        }
    }, [visiblePage, scrollToPage]);

    const handleNextPage = useCallback(() => {
        if (visiblePage < totalPages) {
            const newPage = visiblePage + 1;
            scrollToPage(newPage);
        }
    }, [visiblePage, totalPages, scrollToPage]);

    const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPageInput(e.target.value);
    };

    const handlePageInputSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            const pageNum = parseInt(pageInput, 10);
            if (!isNaN(pageNum) && pageNum > 0 && pageNum <= totalPages) {
                scrollToPage(pageNum);
            } else {
                setPageInput(visiblePage.toString());
            }
        }
    };

    const handlePageInputBlur = () => {
        const pageNum = parseInt(pageInput, 10);
        if (!isNaN(pageNum) && pageNum > 0 && pageNum <= totalPages) {
            scrollToPage(pageNum);
        } else {
            setPageInput(visiblePage.toString());
        }
    };

    const handleWheel = useCallback((e: React.WheelEvent) => {
        if (e.ctrlKey) {
            e.preventDefault();

            // Normalize the wheel delta and multiply by sensitivity
            const delta =
                ((Math.sign(e.deltaY) * Math.abs(e.deltaY)) / 100) *
                ZOOM_SENSITIVITY;

            setScale((s) => {
                const newScale = s - delta * ZOOM_STEP;
                return Math.min(4, Math.max(0.4, newScale));
            });
        }
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback(() => {
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files[0];
            if (file && onFileDrop) onFileDrop(file);
        },
        [onFileDrop],
    );

    useEffect(() => {
        if (loadedPages.size > 0) {
            loadedPages.forEach((pageNum) => {
                renderPage(pageNum);
            });
        }
    }, [loadedPages, renderPage]);

    useEffect(() => {
        if (loadedPages.size > 0) {
            loadedPages.forEach((pageNum) => {
                unloadPage(pageNum);
                renderPage(pageNum);
            });
        }
    }, [scale]);

    return (
        <div
            className="flex flex-col h-full bg-transparent"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onMouseUp={handleMouseUp}
        >
            {/* ── Glass Toolbar ── */}
            <div className="glass-header flex items-center justify-between px-5 py-3">
                <h2
                    className="text-base font-semibold text-primary-200 tracking-tight truncate max-w-[300px]"
                    title={fileName || pdfInfo?.Title || "PDF Viewer"}
                >
                    {fileName || pdfInfo?.Title || "PDF Viewer"}
                </h2>
                <div className="flex items-center gap-2">
                    {/* Page Navigation */}
                    <div className="flex items-center gap-1 mr-2">
                        <button
                            onClick={handlePrevPage}
                            disabled={visiblePage <= 1}
                            className="p-1.5 rounded-lg bg-white/5 border border-white/8 text-primary-200 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
                            title="Previous Page"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                        </button>
                        <div className="flex items-center bg-white/5 border border-white/8 rounded-lg px-2 py-1">
                            <input
                                type="text"
                                value={pageInput}
                                onChange={handlePageInputChange}
                                onKeyDown={handlePageInputSubmit}
                                onBlur={handlePageInputBlur}
                                className="w-10 bg-transparent text-primary-200 text-sm text-center outline-none tabular-nums"
                            />
                            <span className="text-primary-400/60 text-sm mx-1">/</span>
                            <span className="text-primary-400/60 text-sm tabular-nums">{totalPages || 0}</span>
                        </div>
                        <button
                            onClick={handleNextPage}
                            disabled={visiblePage >= totalPages}
                            className="p-1.5 rounded-lg bg-white/5 border border-white/8 text-primary-200 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
                            title="Next Page"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                            </svg>
                        </button>
                    </div>
                    <div className="w-px h-5 bg-white/10" />
                    <button
                        onClick={handleZoomOut}
                        className="p-2 rounded-xl bg-white/5 border border-white/8 text-primary-200 hover:bg-white/10 hover:scale-105 active:scale-95 transition-all duration-200"
                        title="Zoom Out"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-4 w-4"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                        >
                            <path
                                fillRule="evenodd"
                                d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
                                clipRule="evenodd"
                            />
                        </svg>
                    </button>
                    <span className="text-primary-300/80 w-14 text-center text-xs font-medium tabular-nums">
                        {Math.round(scale * 100)}%
                    </span>
                    <button
                        onClick={handleZoomIn}
                        className="p-2 rounded-xl bg-white/5 border border-white/8 text-primary-200 hover:bg-white/10 hover:scale-105 active:scale-95 transition-all duration-200"
                        title="Zoom In"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-4 w-4"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                        >
                            <path
                                fillRule="evenodd"
                                d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                                clipRule="evenodd"
                            />
                        </svg>
                    </button>
                    <button
                        onClick={onFileOpen}
                        className="glass-button px-4 py-2 text-white text-sm font-medium rounded-xl flex items-center gap-2 ml-2"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-4 w-4"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                        >
                            <path
                                fillRule="evenodd"
                                d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
                                clipRule="evenodd"
                            />
                        </svg>
                        Open File
                    </button>
                </div>
            </div>

            {/* ── Content Area ── */}
            <div
                className="flex-1 overflow-auto p-6"
                ref={containerRef}
                onWheel={handleWheel}
            >
                {loading ? (
                    <div className="flex items-center justify-center h-full animate-fade-in">
                        <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary-500/30 border-t-primary-400"></div>
                    </div>
                ) : pdfData ? (
                    <div className="flex flex-col items-center gap-6">
                        {Array.from(
                            { length: totalPages },
                            (_, i) => i + 1,
                        ).map((pageNum) => (
                            <div
                                key={pageNum}
                                data-page-num={pageNum}
                                ref={(el) => {
                                    if (el)
                                        pageContainerRefs.current.set(
                                            pageNum,
                                            el,
                                        );
                                    else
                                        pageContainerRefs.current.delete(
                                            pageNum,
                                        );
                                }}
                                style={{
                                    height: pageHeights.get(pageNum) || 0,
                                }}
                                className="relative rounded-xl overflow-hidden shadow-glass-sm bg-white animate-fade-in"
                            />
                        ))}
                    </div>
                ) : (
                    <div
                        className={`flex flex-col items-center justify-center h-full text-primary-300 border-2 border-dashed rounded-2xl transition-all duration-300 ${isDragging ? "border-primary-400 bg-primary-800/30 scale-[1.01]" : "border-primary-700/50"}`}
                    >
                        <div
                            className={`p-5 rounded-2xl bg-primary-800/20 mb-5 transition-all duration-300 ${isDragging ? "animate-pulse-glow" : ""}`}
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-16 w-16"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={1.5}
                                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                                />
                            </svg>
                        </div>
                        <p className="text-lg font-medium text-primary-200">
                            Drag and drop a PDF here
                        </p>
                        <p className="text-sm mt-1.5 text-primary-400/80">
                            or click "Open File" to browse
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default PDFViewer;
