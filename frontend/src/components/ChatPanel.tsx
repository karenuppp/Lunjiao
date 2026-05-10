import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './chat.css'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  data_sources_used?: string[]
}

interface ChatPanelProps {
  messages: Message[]
  isLoading: boolean
  currentTool: string | null
  uploadedFiles: UploadedFileMeta[]
  onSendChat: (message: string) => void
  onRemoveUploadedFile: (fileId: string) => void
}

export default function ChatPanel({
  messages, isLoading,  currentTool, uploadedFiles,
  onSendChat, onRemoveUploadedFile,
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [input])

  const canSend = input.trim().length > 0 && !isLoading

  // ---- Handlers ----
  const handleSend = () => {
    if (!canSend) return
    onSendChat(input.trim())
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // ---- Render ----
  return (
    <div className="chat-area">
      {/* Message area */}
      <div className="chat-messages">
        {messages.length === 0 && !isLoading ? (
          <div className="chat-empty">
            <div style={{ fontSize: 48, marginBottom: 20, opacity: 0.6 }}>💬</div>
            <p style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 500, color: '#1a1b2e' }}>
              今天想查点什么？
            </p>
            <p style={{ margin: '0 0 24px', fontSize: 14, color: '#9ca3af' }}>
              直接提问即可，系统将自动检索知识库与数据库获取答案
            </p>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => {
              const isLastAssistant = idx === messages.length - 1 && msg.role === 'assistant'
              const showLoadingBubble = isLastAssistant && isLoading
              return (
              <div key={msg.id} className={`message ${msg.role}`}>
                <div className="message-avatar">
                  {msg.role === 'user' ? '👤' : '🦌'}
                </div>
                <div className="message-body">
                  {msg.role === 'assistant' && msg.data_sources_used?.length > 0 && !showLoadingBubble && (
                    <div className="data-source-tags">
                      {msg.data_sources_used.map((src, i) => (
                        <span key={i} className="data-source-tag">
                          {src}
                        </span>
                      ))}
                    </div>
                  )}
                  {showLoadingBubble && currentTool && (
                    <div className="data-source-tags">
                      <span className="data-source-tag">{currentTool}</span>
                    </div>
                  )}
                  <div className={`message-bubble ${msg.role}`}>
                    {msg.role === 'user' ? (
                      <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{msg.content}</p>
                    ) : showLoadingBubble ? (
                      <div className="loading-bubble" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {msg.content ? (
                          <>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.content}
                            </ReactMarkdown>
                          </>
                        ) : null}
                        <span className="loading-dot" />
                        <span className="loading-dot" />
                        <span className="loading-dot" />
                      </div>
                    ) : (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    )}
                  </div>
                </div>
              </div>
              )
            })}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* ========== Input area ========== */}
      <div className="chat-input-area">
        {/* Uploaded files */}
        {uploadedFiles.length > 0 && (
          <div className="uploaded-files-list">
            {uploadedFiles.map((f) => (
              <div key={f.fileId} className="uploaded-file-chip">
                <span className="file-name" title={f.fileName}>{f.fileName}</span>
                <span style={{ fontSize: 10, color: f.ragStatus === 'indexed' ? '#22c55e' : '#ca8a04', padding: '1px 6px', borderRadius: 3, background: f.ragStatus === 'indexed' ? '#dcfce7' : '#fef9c3' }}>
                  {f.ragStatus === 'indexed' ? '已索引' : '索引中'}
                </span>
                <span style={{ color: '#9ca3af', fontSize: 10 }}>{formatFileSize(f.fileSize)}</span>
                <button className="remove-btn" onClick={() => onRemoveUploadedFile(f.fileId)}>×</button>
              </div>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="input-wrapper">
          <textarea ref={textareaRef} placeholder="直接提问，系统将自动检索知识库与数据库…"
            value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} rows={1} disabled={isLoading} />
        </div>

        {/* Controls — send */}
        <div className="input-controls">
          <button className={`send-btn ${canSend ? 'active' : ''}`} onClick={handleSend} disabled={!canSend}>
            发送 ↵
          </button>
        </div>
      </div>
    </div>
  )
}
