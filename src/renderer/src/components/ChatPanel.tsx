import { useState, useEffect, useRef, useCallback } from 'react'
import type { Message } from '../App'
import React from 'react'

interface ChatPanelProps {
  sessionId: number | null
  selectedText: string | null
  onClearSelection: () => void
}

function ChatPanel({ sessionId, selectedText, onClearSelection }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    if (sessionId) {
      loadMessages()
    }
  }, [sessionId])

  const loadMessages = async () => {
    if (!sessionId) return
    const msgs = await window.electronAPI.getMessages(sessionId)
    setMessages(msgs)
  }

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || !sessionId) return

    const userMessage = inputValue.trim()
    const fullMessage = selectedText 
      ? `[[TEXT:${selectedText}]]\n${userMessage}`
      : userMessage
    
    setInputValue('')
    onClearSelection()

    await window.electronAPI.addMessage(sessionId, 'user', fullMessage)
    await loadMessages()

    setIsTyping(true)
    setTimeout(async () => {
      setIsTyping(false)
      const botResponse = "I'm a placeholder bot. Your message was: " + userMessage
      await window.electronAPI.addMessage(sessionId, 'assistant', botResponse)
      await loadMessages()
    }, 1500)
  }, [inputValue, sessionId, selectedText, onClearSelection])

  const parseMessage = (content: string): { mainText: string; attachedText: string | null } => {
    const match = content.match(/^\[\[TEXT:(.+)\]\]\n(.*)$/s)
    if (match) {
      return {
        mainText: match[2],
        attachedText: match[1]
      }
    }
    return { mainText: content, attachedText: null }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleClearChat = async () => {
    if (sessionId) {
      await window.electronAPI.clearMessages(sessionId)
      setMessages([])
    }
  }

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="flex flex-col h-full bg-primary-950">
      <div className="flex items-center justify-between px-4 py-3 bg-primary-900 border-b border-primary-800">
        <h2 className="text-lg font-semibold text-primary-400">Chat Assistant</h2>
        <button
          onClick={handleClearChat}
          className="p-2 text-primary-300 hover:text-red-400 hover:bg-primary-800 rounded-lg transition-colors"
          title="Clear chat"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-primary-400">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-lg font-medium">Start a conversation</p>
            <p className="text-sm">Ask me anything about your PDF</p>
          </div>
        ) : (
          messages.map((msg) => {
            const { mainText, attachedText } = parseMessage(msg.content)
            return (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className="max-w-[80%]">
                {attachedText && (
                  <div className={`mb-1 px-3 py-1.5 rounded-lg text-xs ${
                    msg.role === 'user' 
                      ? 'bg-primary-600/30 text-primary-200' 
                      : 'bg-primary-800/50 text-primary-300'
                  }`}>
                    <span className="font-medium">📎 Attached: </span>
                    {attachedText.length > 50 ? attachedText.substring(0, 50) + '...' : attachedText}
                  </div>
                )}
                <div
                  className={`rounded-2xl px-4 py-2 ${
                    msg.role === 'user'
                      ? 'bg-primary-600 text-white rounded-br-md'
                      : 'bg-primary-800 text-primary-100 rounded-bl-md'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{mainText}</p>
                  <p className={`text-xs mt-1 ${msg.role === 'user' ? 'text-primary-200' : 'text-primary-400'}`}>
                    {formatTime(msg.timestamp)}
                  </p>
                </div>
              </div>
            </div>
          )})
        )}
        
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-primary-800 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {selectedText && (
        <div className="px-4 py-2 bg-primary-900/50 border-t border-primary-800">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="flex items-center gap-1.5 px-2 py-1 bg-primary-600/20 rounded-md border border-primary-500/30">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-primary-400" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                </svg>
                <span className="text-xs text-primary-300 font-medium">Text selected</span>
              </div>
              <span className="text-sm text-primary-300 truncate">
                {selectedText.length > 40 ? selectedText.substring(0, 40) + '...' : selectedText}
              </span>
            </div>
            <button
              onClick={onClearSelection}
              className="p-1.5 text-primary-300 hover:text-red-400 hover:bg-primary-800 rounded-lg transition-colors flex-shrink-0"
              title="Deselect"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className="p-4 bg-primary-900 border-t border-primary-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type your message..."
            className="flex-1 bg-primary-800 text-white placeholder-primary-400 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-opacity-50"
          />
          <button
            onClick={handleSendMessage}
            disabled={!inputValue.trim()}
            className="p-3 bg-primary-600 hover:bg-primary-500 disabled:bg-primary-800 disabled:cursor-not-allowed text-white rounded-xl transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

export default ChatPanel
