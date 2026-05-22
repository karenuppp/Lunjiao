import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MessageSquare, User, Sparkles, Loader2, X, SendHorizontal, FileText, Table2, Presentation, Archive, Image as ImageIcon, FileType, Paperclip } from 'lucide-react'
import './chat.css'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  data_sources_used?: string[]
}

interface ContextFile {
  id: string
  name: string
  size: number
}

interface ChatPanelProps {
  messages: Message[]
  isLoading: boolean
  currentTool: string | null
  onSendChat: (message: string, contextFiles?: ContextFile[]) => void
}

let fileIdCounter = 0

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** File type → { icon, colorClass } */
function getFileTypeMeta(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'pdf':   return { icon: <FileText size={14} />,     colorClass: 'file-red' }
    case 'docx':
    case 'doc':   return { icon: <FileType size={14} />,     colorClass: 'file-blue' }
    case 'xlsx':
    case 'xls':
    case 'csv':   return { icon: <Table2 size={14} />,       colorClass: 'file-green' }
    case 'pptx':  return { icon: <Presentation size={14} />, colorClass: 'file-orange' }
    case 'zip':
    case 'rar':
    case '7z':    return { icon: <Archive size={14} />,      colorClass: 'file-purple' }
    case 'png':
    case 'jpg':
    case 'jpeg':  return { icon: <ImageIcon size={14} />,    colorClass: 'file-pink' }
    default:      return { icon: <FileText size={14} />,     colorClass: 'file-gray' }
  }
}

export default function ChatPanel({
  messages, isLoading, currentTool,
  onSendChat,
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const [contextFiles, setContextFiles] = useState<ContextFile[]>([])
  const [dragOver, setDragOver] = useState(false)

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
    el.style.height = el.scrollHeight + 'px'
  }, [input])

  const canSend = (input.trim().length > 0 || contextFiles.length > 0) && !isLoading

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set false if we're leaving the container
    const target = e.currentTarget as HTMLElement
    const related = e.relatedTarget as HTMLElement | null
    if (!related || !target.contains(related)) {
      setDragOver(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)

    const files = e.dataTransfer.files
    if (!files || files.length === 0) return

    setContextFiles(prev => {
      const next = [...prev]
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        next.push({ id: `cf-${++fileIdCounter}`, name: f.name, size: f.size })
      }
      return next
    })
  }, [])

  const removeContextFile = useCallback((fileId: string) => {
    setContextFiles(prev => prev.filter(f => f.id !== fileId))
  }, [])

  const handlePaperclipClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setContextFiles(prev => {
      const next = [...prev]
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        next.push({ id: `cf-${++fileIdCounter}`, name: f.name, size: f.size })
      }
      return next
    })
    // Reset so same file can be re-selected
    e.target.value = ''
  }

  const handleSend = () => {
    if (!canSend) return
    onSendChat(input.trim(), contextFiles.length > 0 ? contextFiles : undefined)
    setInput('')
    setContextFiles([])
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="chat-area">
      <div className="chat-messages">
        {messages.length === 0 && !isLoading ? (
          <div className="chat-empty">
            <MessageSquare size={56} strokeWidth={1.2} className="empty-icon" style={{ color: '#C7D2FE', marginBottom: '16px' }} />
            <p style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600, color: '#0F172A', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              今天想查点什么？
            </p>
            <p style={{ margin: '0 0 32px', fontSize: 14, color: '#9CA3AF' }}>
              直接提问或拖拽文件作为上下文，系统将自动检索知识库与数据库获取答案
            </p>

            <div className="suggestion-chips">
              <button onClick={() => { setInput('部门考勤制度有哪些？'); textareaRef.current?.focus(); }}>部门考勤制度有哪些？</button>
              <button onClick={() => { setInput('如何申请年假？'); textareaRef.current?.focus(); }}>如何申请年假？</button>
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
                  {msg.role === 'user' ? (
                    <User size={16} strokeWidth={2} />
                  ) : (
                    <Sparkles size={16} strokeWidth={2} />
                  )}
                </div>

                <div className="message-body">
                  {msg.role === 'assistant' && (msg.data_sources_used?.length ?? 0) > 0 && !showLoadingBubble && (
                    <div className="data-source-tags">
                      {msg.data_sources_used!.map((src, i) => (
                        <span key={i} className="data-source-tag">{src}</span>
                      ))}
                    </div>
                  )}
                  {showLoadingBubble && currentTool && (
                    <div className="tool-call-indicator">
                      <Loader2 size={14} className="progress-spinner" />
                      <span>{currentTool}</span>
                    </div>
                  )}

                  <div className={`message-bubble ${msg.role}`}>
                    {msg.role === 'user' ? (
                      <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{msg.content}</p>
                    ) : showLoadingBubble ? (
                      <div className="loading-cursor-area">
                        {msg.content && (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                        )}
                        <span className="loading-cursor" />
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

      <div
        className={`chat-input-area ${dragOver ? 'drag-over' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {contextFiles.length > 0 && (
          <div className="context-files-bar">
            {contextFiles.map((cf) => {
              const meta = getFileTypeMeta(cf.name)
              return (
                <div key={cf.id} className={`context-file-chip ${meta.colorClass}`}>
                  <div className="cf-icon">{meta.icon}</div>
                  <span className="cf-name" title={cf.name}>{cf.name}</span>
                  <span className="cf-size">{formatFileSize(cf.size)}</span>
                  <button className="cf-remove" onClick={() => removeContextFile(cf.id)} title="移除">
                    <X size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <div className="input-wrapper">
          <textarea
            ref={textareaRef}
            placeholder={contextFiles.length > 0 ? '输入问题…' : '直接提问或拖拽文件作为上下文，系统将自动检索知识库…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isLoading}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden-file-input"
            onChange={handleFileInputChange}
          />
          <button
            className="attach-btn"
            onClick={handlePaperclipClick}
            disabled={isLoading}
            title="添加文件"
          >
            <Paperclip size={18} strokeWidth={1.8} />
          </button>
          <button
            className={`send-btn ${canSend ? 'active' : ''}`}
            onClick={handleSend}
            disabled={!canSend}
          >
            {canSend ? (
              <><SendHorizontal size={14} style={{ marginRight: 4 }} />发送</>
            ) : '发送'}
          </button>
        </div>
      </div>
    </div>
  )
}
