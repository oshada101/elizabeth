import { useState, useRef, useEffect, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import React from 'react'

pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

interface PDFViewerProps {
  pdfData: Uint8Array | null
  onFileOpen: () => void
  onFileDrop: (file: File) => void
  onTextSelect?: (text: string) => void
}

function PDFViewer({ pdfData, onFileOpen, onFileDrop, onTextSelect }: PDFViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(1.2)
  const [isDragging, setIsDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [renderedPages, setRenderedPages] = useState<Array<{pageNum: number, height: number, textItems: any[]}>>([])

  useEffect(() => {
    if (pdfData) {
      setLoading(true)
      const loadingTask = pdfjsLib.getDocument({ data: pdfData })
      loadingTask.promise.then((pdfDoc) => {
        setPdf(pdfDoc)
        setTotalPages(pdfDoc.numPages)
        setLoading(false)
      }).catch((err) => {
        console.error('Error loading PDF:', err)
        setLoading(false)
      })
    }
  }, [pdfData])

  useEffect(() => {
    if (pdf) {
      const renderAllPages = async () => {
        const pages: Array<{pageNum: number, height: number, textItems: any[]}> = []
        
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const viewport = page.getViewport({ scale })
          const textContent = await page.getTextContent()
          
          pages.push({
            pageNum: i,
            height: viewport.height,
            textItems: textContent.items
          })
        }
        
        setRenderedPages(pages)
      }
      
      renderAllPages()
    }
  }, [pdf, scale])

  const handleMouseUp = useCallback(() => {
    setTimeout(() => {
      const selection = window.getSelection()
      const selectedText = selection?.toString().trim() || ''
      
      if (selectedText.length > 0 && onTextSelect) {
        onTextSelect(selectedText)
      }
    }, 10)
  }, [onTextSelect])

  const handleZoomIn = () => setScale(scale + 0.2)
  const handleZoomOut = () => setScale(Math.max(0.4, scale - 0.2))

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) onFileDrop(file)
  }, [onFileDrop])

  const renderPage = useCallback((pageNum: number, textItems: any[]) => {
    if (!pdf) return null
    
    pdf.getPage(pageNum).then(async (page) => {
      const canvasId = `canvas-${pageNum}`
      const textLayerId = `textlayer-${pageNum}`
      const canvas = document.getElementById(canvasId) as HTMLCanvasElement
      const textLayerDiv = document.getElementById(textLayerId) as HTMLDivElement
      
      if (!canvas || !textLayerDiv) return
      
      const viewport = page.getViewport({ scale })
      const context = canvas.getContext('2d')!
      
      canvas.height = viewport.height
      canvas.width = viewport.width
      
      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise

      textLayerDiv.innerHTML = ''
      textLayerDiv.style.width = `${viewport.width}px`
      textLayerDiv.style.height = `${viewport.height}px`
      
      textItems.forEach((item: any) => {
        if ('str' in item && item.str.trim()) {
          const tx = pdfjsLib.Util.transform(viewport.transform, item.transform)
          
          const span = document.createElement('span')
          span.textContent = item.str
          
          const fontHeight = Math.sqrt((item.transform[0] * item.transform[0]) + (item.transform[1] * item.transform[1]))
          const fontSize = fontHeight * scale
          
          span.style.position = 'absolute'
          span.style.left = `${tx[4]}px`
          span.style.top = `${tx[5] - fontSize + 5}px`
          span.style.fontSize = `${fontSize}px`
          span.style.fontFamily = 'Arial, Helvetica, sans-serif'
          span.style.whiteSpace = 'pre'
          span.style.color = 'transparent'
          span.style.userSelect = 'text'
          span.style.cursor = 'text'
          span.style.lineHeight = '1'
          
          textLayerDiv.appendChild(span)
        }
      })
    })
  }, [pdf, scale])

  useEffect(() => {
    if (renderedPages.length > 0) {
      renderedPages.forEach(({ pageNum, textItems }) => {
        renderPage(pageNum, textItems)
      })
    }
  }, [renderedPages, renderPage])

  return (
    <div 
      className="flex flex-col h-full bg-primary-900"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onMouseUp={handleMouseUp}
    >
      <div className="flex items-center justify-between px-4 py-3 bg-primary-800 border-b border-primary-700">
        <h2 className="text-lg font-semibold text-primary-400">PDF Viewer</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleZoomOut}
            className="p-2 bg-primary-700 hover:bg-primary-600 rounded-lg transition-colors"
            title="Zoom Out"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
            </svg>
          </button>
          <span className="text-primary-200 w-14 text-center text-sm">{Math.round(scale * 100)}%</span>
          <button
            onClick={handleZoomIn}
            className="p-2 bg-primary-700 hover:bg-primary-600 rounded-lg transition-colors"
            title="Zoom In"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
          </button>
          <button
            onClick={onFileOpen}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg transition-colors flex items-center gap-2 ml-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
            </svg>
            Open File
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4" ref={containerRef}>
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500"></div>
          </div>
        ) : pdfData ? (
          <div className="flex flex-col items-center gap-4">
            {renderedPages.map(({ pageNum, textItems }) => (
              <div key={pageNum} className="relative shadow-2xl bg-white">
                <canvas id={`canvas-${pageNum}`} className="block" />
                <div 
                  id={`textlayer-${pageNum}`}
                  className="absolute top-0 left-0 select-text overflow-hidden"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className={`flex flex-col items-center justify-center h-full text-primary-300 border-2 border-dashed rounded-xl transition-colors ${isDragging ? 'border-primary-400 bg-primary-800/50' : 'border-primary-700'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-lg font-medium">Drag and drop a PDF here</p>
            <p className="text-sm mt-1">or click "Open File" to browse</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default PDFViewer
