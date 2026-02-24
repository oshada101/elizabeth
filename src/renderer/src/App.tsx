import { useState, useEffect, useCallback } from 'react'
import PDFViewer from './components/PDFViewer'
import ChatPanel from './components/ChatPanel'
import React from 'react'

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
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [selectedText, setSelectedText] = useState<string | null>(null)

  useEffect(() => {
    const loadSession = async () => {
      const sessions = await window.electronAPI.getSessions()
      if (sessions.length > 0) {
        const lastSession = sessions[0]
        setSessionId(lastSession.id)
        if (lastSession.pdf_path) {
          const buffer = await window.electronAPI.readFile(lastSession.pdf_path)
          if (buffer) {
            setPdfPath(lastSession.pdf_path)
            setPdfData(new Uint8Array(buffer))
          } else {
            setPdfPath(null)
            setPdfData(null)
          }
        }
      } else {
        const newSessionId = await window.electronAPI.createSession('')
        setSessionId(newSessionId)
      }
    }
    loadSession()
  }, [])

  const handleFileOpen = useCallback(async () => {
    const filePath = await window.electronAPI.openFileDialog()
    if (filePath) {
      const buffer = await window.electronAPI.readFile(filePath)
      if (buffer) {
        setPdfPath(filePath)
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
    }
  }, [])

  const handleTextSelect = useCallback((text: string) => {
    setSelectedText(text)
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelectedText(null)
    window.getSelection()?.removeAllRanges()
  }, [])

  return (
    <div className="flex h-screen bg-primary-950">
      <div className="w-4/6 h-full border-r border-slate-700">
        <PDFViewer 
          pdfData={pdfData} 
          onFileOpen={handleFileOpen}
          onFileDrop={handleFileDrop}
          onTextSelect={handleTextSelect}
        />
      </div>
      <div className="w-2/6 h-full">
        <ChatPanel 
          sessionId={sessionId} 
          selectedText={selectedText}
          onClearSelection={handleClearSelection}
        />
      </div>
    </div>
  )
}

export default App
