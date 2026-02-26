import { useState, useEffect, useCallback } from 'react'
import PDFViewer from './components/PDFViewer'
import ChatPanel from './components/ChatPanel'
import TOCPanel from './components/TOCPanel'
import React from 'react'
import * as pdfjsLib from 'pdfjs-dist'

declare global {
  interface Window {
    electronAPI: {
      openFileDialog: () => Promise<string | null>
      readFile: (filePath: string) => Promise<Buffer | null>
      getSessions: () => Promise<Session[]>
      createSession: (pdfPath: string) => Promise<number | null>
      updateSession: (sessionId: number, pdfPath: string) => Promise<void>
      getMessages: (sessionId: number) => Promise<Message[]>
      addMessage: (sessionId: number, role: string, content: string) => Promise<number>
      clearMessages: (sessionId: number) => Promise<void>
    }
  }
}

export interface Session {
  id: number
  pdf_path: string
  created_at: string
  updated_at: string
}

export interface Message {
  id: number
  session_id: number
  role: string
  content: string
  timestamp: string
}

function App() {
  const [pdfPath, setPdfPath] = useState<string | null>(null)
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null)
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [selectedText, setSelectedText] = useState<string | null>(null)
  const [tocOpen, setTocOpen] = useState(true)
  const [chatOpen, setChatOpen] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    const initSession = async () => {
      try {
        const sessions = await window.electronAPI.getSessions()
        if (sessions.length > 0) {
          const lastSession = sessions[0]
          setSessionId(lastSession.id)
        } else {
          const newSessionId = await window.electronAPI.createSession('')
          setSessionId(newSessionId)
        }
      } catch (error) {
        console.error('Error initializing session:', error)
        const newSessionId = await window.electronAPI.createSession('')
        setSessionId(newSessionId)
      }
    }
    initSession()
  }, [])

  const handleFileOpen = useCallback(async () => {
    const filePath = await window.electronAPI.openFileDialog()
    if (filePath) {
      const buffer = await window.electronAPI.readFile(filePath)
      if (buffer) {
        setPdfPath(filePath)
        setFileName(filePath.split(/[\\/]/).pop() || null)
        setPdfData(new Uint8Array(buffer))
        if (sessionId) {
          await window.electronAPI.updateSession(sessionId, filePath)
        }
      }
    }
  }, [sessionId])

  const handleFileDrop = useCallback(async (file: File) => {
    if (file.type === 'application/pdf') {
      const arrayBuffer = await file.arrayBuffer()
      setPdfData(new Uint8Array(arrayBuffer))
      setPdfPath(null)
      setFileName(file.name)
    }
  }, [])

  const handleTextSelect = useCallback((text: string) => {
    setSelectedText(text)
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelectedText(null)
    window.getSelection()?.removeAllRanges()
  }, [])

  const handleNavigate = useCallback((pageNum: number) => {
    setCurrentPage(pageNum)
  }, [])

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page)
  }, [])

  const handlePdfLoad = useCallback((pdfDoc: pdfjsLib.PDFDocumentProxy) => {
    setPdf(pdfDoc)
  }, [])

  return (
    <div className="flex h-screen bg-primary-950 p-3 gap-3">
      {/* TOC Panel */}
      <div
        className={`h-full rounded-2xl overflow-hidden glass-panel shadow-glass transition-all duration-300 ease-in-out  ${tocOpen ? 'w-80 opacity-100' : 'w-0 opacity-0 p-0'
          }`}
      >
        {tocOpen && (
          <TOCPanel
            pdf={pdf}
            onNavigate={handleNavigate}
            currentPage={currentPage}
          />
        )}
      </div>

      {/* PDF Panel */}
      <div className="flex-1 h-full rounded-2xl overflow-hidden glass-panel shadow-glass">
        <PDFViewer
          pdfData={pdfData}
          onFileOpen={handleFileOpen}
          onFileDrop={handleFileDrop}
          onTextSelect={handleTextSelect}
          fileName={fileName || undefined}
          navigateToPage={currentPage}
          onPageChange={handlePageChange}
          onPdfLoad={handlePdfLoad}
        />
      </div>

      {/* Chat Panel */}
      <div
        className={`h-full rounded-2xl overflow-hidden glass-panel shadow-glass transition-all duration-300 ease-in-out ${chatOpen ? 'w-[500px] opacity-100' : 'w-0 opacity-0 p-0'
          }`}
      >
        {chatOpen && (
          <ChatPanel
            sessionId={sessionId}
            selectedText={selectedText}
            onClearSelection={handleClearSelection}
          />
        )}
      </div>

      {/* Floating Toolbar */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-primary-900 rounded-full px-2 py-2 flex items-center gap-2 shadow-glass">
        <button
          onClick={() => setTocOpen(!tocOpen)}
          className={`p-2 rounded-full transition-all duration-200 ${tocOpen ? 'bg-purple-500/30 text-purple-200' : 'bg-white/5 text-primary-300 hover:bg-white/10'
            }`}
          title="Toggle Table of Contents"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 4a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1H3a1 1 0 01-1-1V4zM4 8a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V8zM2 14a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1H3a1 1 0 01-1-1v-2zM8 12a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H9a1 1 0 01-1-1v-2z" />
          </svg>
        </button>
        <div className="w-px h-5 bg-white/10" />
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className={`p-2 rounded-full transition-all duration-200 ${chatOpen ? 'bg-purple-500/30 text-purple-200' : 'bg-white/5 text-primary-300 hover:bg-white/10'
            }`}
          title="Toggle Chat"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export default App
