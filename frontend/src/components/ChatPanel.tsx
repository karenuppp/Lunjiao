import { useState, useRef, useEffect, ChangeEvent, DragEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { message } from 'antd'
import { uploadFilesBatch } from '../api/chat'
import type { UploadedFile } from '../types/chat'
import { useChat } from '../store/chatStore'
import './chat.css'

const SUGGESTIONS = [
  '上月设备故障率趋势',
  '各部门人员分布',
  '本季度财务支出汇总',
]

const ALLOWED_EXTENSIONS = ['.pdf','.docx','.doc','.xlsx','.xls','.pptx','.csv','.txt','.md','.png','.jpg','.jpeg']
const MAX_FILE_SIZE = 50 * 1024 * 1024

function isAllowedFile(name: string): boolean {
  const ext = '.' + name.split('.').pop()?.toLowerCase()
  return ALLOWED_EXTENSIONS.includes(ext)
}

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
  onUploadFile: (file: File) => void
  onRemoveUploadedFile: (fileId: string) => void
  onOpenKbList?: () => void
}

export default function ChatPanel({
  messages, isLoading,  currentTool, uploadedFiles,
  onSendChat, onUploadFile, onRemoveUploadedFile, onOpenKbList,
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const [showUploadZone, setShowUploadZone] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const { dispatch } = useChat()

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  // ============================================================
  // File upload handlers — supports single & multi-file via drag/drop or click
  // ============================================================

  const handleFileSelect = async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return

    // Validate each file
    for (const file of fileArray) {
      if (file.size > 50 * 1024 * 1024) {
        message.warning(`${file.name} 超过 50MB，已跳过`)
        continue
      }
    }

    const validFiles = fileArray.filter((f) => f.size <= 50 * 1024 * 1024)
    if (validFiles.length === 0) return

    setUploading(true)
    try {
      const result = await uploadFilesBatch(validFiles)
      // Add successfully uploaded files to store
      for (const meta of result.files) {
        dispatch({
          type: 'ADD_UPLOADED_FILE',
          payload: {
            fileId: meta.file_id,
            fileName: meta.file_name,
            fileSize: meta.file_size,
            ragStatus: meta.rag_status,
          },
        })
      }

      if (result.success_count > 0) {
        message.success(`上传成功 ${result.success_count} 个文件`)
      }
      if (result.errors.length > 0) {
        message.error(
          `${result.errors.length} 个文件上传失败: ${result.errors.map((e) => e.filename).join(', ')}`,
        )
      }
    } catch (err) {
      console.error('Batch upload error:', err)
      message.error('批量上传失败')
    } finally {
      setUploading(false)
      setShowUploadZone(false)
    }
  }

  const handleInputFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleFileSelect(e.target.files)
    e.target.value = ''
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files)
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
            <p style={{ margin: '0 0 36px', fontSize: 14, color: '#9ca3af' }}>
              直接提问即可，系统将自动检索知识库与数据库获取答案
            </p>
            {/* Suggestion chips */}
            <div className="suggestion-chips" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => onSendChat(s)}>
                  {s}
                </button>
              ))}
            </div>
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
        {/* Upload zone */}
        {showUploadZone && (
          <div
            className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
            onDrop={handleDrop} onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? '上传中...' : (
              <span>📎 拖拽文件到此处，或点击选择<br />
                <small style={{ color: '#9ca3af' }}>支持多文件，PDF, DOCX, XLSX, CSV, TXT, MD（最大 50MB/个）</small>
              </span>
            )}
          </div>
        )}
        <input ref={fileInputRef} type="file" multiple
          style={{ display: 'none' }} onChange={handleInputFileChange}
          accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.csv,.txt,.md,.png,.jpg,.jpeg" />

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

        {/* Controls — upload + knowledge base list + send */}
        <div className="input-controls">
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="input-btn" onClick={() => setShowUploadZone(!showUploadZone)}>📎 上传文件</button>
            <button className="input-btn" onClick={() => onOpenKbList?.()}>📂 知识库列表</button>
          </div>
          <button className={`send-btn ${canSend ? 'active' : ''}`} onClick={handleSend} disabled={!canSend}>
            发送 ↵
          </button>
        </div>
      </div>
    </div>
  )
}
