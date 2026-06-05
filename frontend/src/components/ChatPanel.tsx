import { useState, useRef, useEffect, useCallback, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Select, Spin } from 'antd'
import { User, Sparkles, Loader2, X, FileText, Table2, Presentation, Archive, Image as ImageIcon, FileType, Paperclip } from 'lucide-react'
import { listPromptTemplates, type PromptTemplate } from '../api/chat'
import './chat.css'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  data_sources_used?: string[]
  message_id?: string
  feedback_rating?: 'up' | 'down'
  experience_suggest?: { topic: string; summary: string; category?: string } | null
  template_name?: string
}

interface ContextFile {
  id: string
  name: string
  size: number
  file: File
  status: 'uploading' | 'done' | 'error'
  error?: string
}

interface ChatPanelProps {
  messages: Message[]
  loadingConversationIds: string[]
  activeConversationId: string | null
  currentTool: string | null
  highlightMessageId?: string | null
  onSendChat: (message: string, contextFiles?: ContextFile[], category?: string, visibleMessage?: string, systemPrompt?: string) => void
  onFeedback: (messageId: string, rating: 'up' | 'down') => void
  onSaveExperienceSuggestion?: (messageId: string) => void
  onDismissExperienceSuggestion?: (messageId: string) => void
  uploadFile?: (file: File) => Promise<{ fileId: string; fileName: string } | null>
}

let fileIdCounter = 0

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

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

// Debounced markdown renderer — only re-renders every 150ms during streaming
function StreamingMarkdown({ content, streaming }: { content: string; streaming: boolean }) {
  const [debouncedContent, setDebouncedContent] = useState(content)
  const lastUpdateRef = useRef(Date.now())

  useEffect(() => {
    if (!streaming) {
      setDebouncedContent(content)
      return
    }
    const now = Date.now()
    const elapsed = now - lastUpdateRef.current
    if (elapsed >= 150) {
      lastUpdateRef.current = now
      setDebouncedContent(content)
    } else {
      const timer = setTimeout(() => {
        lastUpdateRef.current = Date.now()
        setDebouncedContent(content)
      }, 150 - elapsed)
      return () => clearTimeout(timer)
    }
  }, [content, streaming])

  if (!debouncedContent) return null
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{debouncedContent}</ReactMarkdown>
}

// Memoized message item — skips re-render if content/fb unchanged
const MessageItem = memo(function MessageItem({
  msg,
  idx,
  messagesLen,
  isLoading,
  currentTool,
  highlightMessageId,
  onFeedback,
  onSaveExperienceSuggestion,
  onDismissExperienceSuggestion,
}: {
  msg: Message
  idx: number
  messagesLen: number
  isLoading: boolean
  currentTool: string | null
  highlightMessageId?: string | null
  onFeedback: (messageId: string, rating: 'up' | 'down') => void
  onSaveExperienceSuggestion?: (messageId: string) => void
  onDismissExperienceSuggestion?: (messageId: string) => void
}) {
  const isLastAssistant = idx === messagesLen - 1 && msg.role === 'assistant'
  const showLoadingBubble = isLastAssistant && isLoading
  const msgId = msg.message_id || msg.id
  const isHighlighted = highlightMessageId && (msgId === highlightMessageId || msg.id === highlightMessageId)

  return (
    <div
      key={msg.id}
      className={`message ${msg.role} ${isHighlighted ? 'message-highlight' : ''}`}
      data-message-id={msgId}
    >
      <div className="message-avatar">
        {msg.role === 'user' ? (
          <User size={16} strokeWidth={2} />
        ) : (
          <Sparkles size={16} strokeWidth={2} />
        )}
      </div>

      <div className="message-body">
        {msg.template_name && (
          <div className="template-tag">
            <FileText size={11} />
            <span>{msg.template_name}</span>
          </div>
        )}
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
              <StreamingMarkdown content={msg.content} streaming={!!msg.content} />
              <span className="loading-cursor" />
            </div>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {msg.content}
            </ReactMarkdown>
          )}
        </div>

        {msg.role === 'assistant' && !showLoadingBubble && msg.content && (
          <div className="feedback-row">
            <button
              className={`feedback-btn ${msg.feedback_rating === 'up' ? 'active-up' : ''}`}
              onClick={() => {
                const msgId = msg.message_id || msg.id
                onFeedback(msgId, 'up')
              }}
              title="回答有用"
              disabled={!!msg.feedback_rating}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 22V11M2 13v7a2 2 0 0 0 2 2h12.4a2 2 0 0 0 1.94-1.52l2.1-8.4A2 2 0 0 0 18.5 10H14V4a2 2 0 0 0-2-2l-5 9Z"/>
              </svg>
            </button>
            <button
              className={`feedback-btn ${msg.feedback_rating === 'down' ? 'active-down' : ''}`}
              onClick={() => {
                const msgId = msg.message_id || msg.id
                onFeedback(msgId, 'down')
              }}
              title="回答需要改进"
              disabled={!!msg.feedback_rating}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 2v11m5-2v-7a2 2 0 0 0-2-2H7.6a2 2 0 0 0-1.94 1.52l-2.1 8.4A2 2 0 0 0 5.5 14H10v6a2 2 0 0 0 2 2l5-9Z"/>
              </svg>
            </button>
            {msg.feedback_rating === 'down' && (
              <span className="feedback-hint">请继续与我对话，帮我纠正这个回答</span>
            )}
          </div>
        )}

        {/* Experience suggestion: save/ignore buttons */}
        {msg.role === 'assistant' && !showLoadingBubble && msg.experience_suggest && (
          <div className="experience-suggest-banner">
            <span className="exp-suggest-icon">💡</span>
            <span className="exp-suggest-text">
              是否将该经验保存到经验库？
            </span>
            <button
              className="exp-suggest-btn save"
              onClick={() => {
                const msgId = msg.message_id || msg.id
                onSaveExperienceSuggestion?.(msgId)
              }}
            >
              保存
            </button>
            <button
              className="exp-suggest-btn ignore"
              onClick={() => {
                const msgId = msg.message_id || msg.id
                onDismissExperienceSuggestion?.(msgId)
              }}
            >
              忽略
            </button>
          </div>
        )}
      </div>
    </div>
  )
})

export default function ChatPanel({
  messages, loadingConversationIds, activeConversationId, currentTool, highlightMessageId,
  onSendChat, onFeedback,
  onSaveExperienceSuggestion, onDismissExperienceSuggestion,
  uploadFile,
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const [contextFiles, setContextFiles] = useState<ContextFile[]>([])
  const [dragOver, setDragOver] = useState(false)

  // Prompt template
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | undefined>(undefined)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const contextFilesRef = useRef<ContextFile[]>([])
  contextFilesRef.current = contextFiles

  const isThisConversationLoading = activeConversationId !== null && loadingConversationIds.includes(activeConversationId)

  // Load templates on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      setTemplatesLoading(true)
      try {
        const data = await listPromptTemplates()
        if (!cancelled) {
          setTemplates(data)
          // Auto-select "系统默认" template
          const systemDefault = data.find(t => t.title === '系统默认' || t.prompt_key === 'system_default')
          if (systemDefault) setSelectedTemplateId(systemDefault.id)
        }
      } catch { }
      finally {
        if (!cancelled) setTemplatesLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    // Throttle scroll: use rAF and only when not in a smooth scroll already
    let rafId: number | undefined
    rafId = requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
    })
    return () => { if (rafId !== undefined) cancelAnimationFrame(rafId) }
  }, [messages, isThisConversationLoading])

  // Scroll to highlighted message
  useEffect(() => {
    if (!highlightMessageId) return
    // Delay to allow messages to render after conversation switch
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-message-id="${highlightMessageId}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [highlightMessageId, messages.length])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [input])

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId)
  const anyFileUploading = contextFiles.some(cf => cf.status === 'uploading')
  const canSend = (input.trim().length > 0 || contextFiles.length > 0) && !isThisConversationLoading && !anyFileUploading

  const startFileUpload = useCallback(async (cf: ContextFile) => {
    if (!uploadFile) {
      setContextFiles(prev => prev.map(f => f.id === cf.id ? { ...f, status: 'error' as const, error: '上传不可用' } : f))
      return
    }
    try {
      const result = await uploadFile(cf.file)
      if (result) {
        setContextFiles(prev => prev.map(f => f.id === cf.id ? { ...f, status: 'done' as const } : f))
      } else {
        setContextFiles(prev => prev.map(f => f.id === cf.id ? { ...f, status: 'error' as const, error: '上传失败' } : f))
      }
    } catch {
      setContextFiles(prev => prev.map(f => f.id === cf.id ? { ...f, status: 'error' as const, error: '上传异常' } : f))
    }
  }, [uploadFile])

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
    const target = e.currentTarget as HTMLElement
    const related = e.relatedTarget as HTMLElement | null
    if (!related || !target.contains(related)) {
      setDragOver(false)
    }
  }, [])

  const addFiles = useCallback((files: FileList | File[]) => {
    const MAX_FILES = 10
    const MAX_SIZE = 10 * 1024 * 1024 // 10MB

    const currentCount = contextFilesRef.current.length
    const remainingSlots = MAX_FILES - currentCount
    if (remainingSlots <= 0) return

    const newFiles: ContextFile[] = []
    const arr = Array.from(files)
    for (let i = 0; i < arr.length && newFiles.length < remainingSlots; i++) {
      const f = arr[i]
      if (f.size > MAX_SIZE) {
        newFiles.push({ id: `cf-${++fileIdCounter}`, name: f.name, size: f.size, file: f, status: 'error', error: '超过10MB' })
        continue
      }
      newFiles.push({ id: `cf-${++fileIdCounter}`, name: f.name, size: f.size, file: f, status: 'uploading' })
    }

    if (newFiles.length === 0) return

    setContextFiles(prev => [...prev, ...newFiles])

    // Upload sequentially to avoid overwhelming backend with concurrent MinerU processes
    ;(async () => {
      for (const cf of newFiles) {
        if (cf.status === 'uploading') {
          await startFileUpload(cf)
        }
      }
    })()
  }, [startFileUpload])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)

    const files = e.dataTransfer.files
    if (!files || files.length === 0) return
    addFiles(files)
  }, [addFiles])

  const removeContextFile = useCallback((fileId: string) => {
    setContextFiles(prev => prev.filter(f => f.id !== fileId))
  }, [])

  const handlePaperclipClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    addFiles(files)
    e.target.value = ''
  }

  const handleSend = () => {
    if (!canSend) return

    // Only include successfully uploaded files
    const readyFiles = contextFiles.filter(cf => cf.status === 'done')

    // Assemble visible message
    let visibleMessage = ''
    if (readyFiles.length > 0) {
      visibleMessage += '参考文件：\n'
      visibleMessage += readyFiles.map(f => `- ${f.name}`).join('\n')
      visibleMessage += '\n\n'
    }
    visibleMessage += input.trim()

    const systemPrompt = selectedTemplate?.content || ''

    onSendChat(visibleMessage, readyFiles.length > 0 ? readyFiles : undefined, selectedTemplate?.title, visibleMessage, systemPrompt)
    setInput('')
    setContextFiles([])
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const selectStyles: React.CSSProperties = {
    minWidth: 200,
  }

  return (
    <div className="chat-area">
      <div className="chat-messages">
        {messages.length === 0 && !isThisConversationLoading ? (
          <div className="chat-empty">
            <img src="/logo-circle.png" alt="知微" style={{ width: 56, height: 56, marginBottom: '16px' }} />
            <p style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600, color: '#0F172A', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              今天想问点什么？
            </p>
            <p style={{ margin: '0 0 32px', fontSize: 14, color: '#9CA3AF' }}>
              直接提问或拖拽文件作为上下文，系统将自动检索知识库与数据库获取答案
            </p>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => (
              <MessageItem
                key={msg.id}
                msg={msg}
                idx={idx}
                messagesLen={messages.length}
                isLoading={isThisConversationLoading}
                currentTool={currentTool}
                highlightMessageId={highlightMessageId}
                onFeedback={onFeedback}
                onSaveExperienceSuggestion={onSaveExperienceSuggestion}
                onDismissExperienceSuggestion={onDismissExperienceSuggestion}
              />
            ))}
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
        <div className="template-selector-row">
          {templatesLoading ? (
            <span className="template-selector-label">
              <Spin size="small" style={{ marginRight: 6 }} />
              加载模板…
            </span>
          ) : (
            <Select
              value={selectedTemplateId}
              onChange={(val) => setSelectedTemplateId(val)}
              placeholder="选择提示词模板"
              allowClear
              placement="topLeft"
              style={selectStyles}
              options={templates.map(t => ({
                value: t.id,
                label: t.title,
              }))}
              notFoundContent={templates.length === 0 ? '暂无提示词模板' : undefined}
            />
          )}
        </div>

        <div className="input-wrapper">
          <textarea
            ref={textareaRef}
            placeholder={contextFiles.length > 0 ? '输入问题…' : '直接提问或拖拽文件作为上下文，系统将自动检索知识库…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isThisConversationLoading}
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
            disabled={isThisConversationLoading}
            title="添加文件（最多10个，每个10MB）"
          >
            <Paperclip size={18} strokeWidth={1.8} />
          </button>
          <button
            className={`send-btn ${canSend ? 'active' : ''}`}
            onClick={handleSend}
            disabled={!canSend}
          >
            {'发送'}
          </button>
        </div>

        {contextFiles.length > 0 && (
          <div className="context-files-bar">
            {contextFiles.map((cf) => {
              const meta = getFileTypeMeta(cf.name)
              const isUploading = cf.status === 'uploading'
              const isError = cf.status === 'error'
              return (
                <div key={cf.id} className={`context-file-chip ${meta.colorClass}${isError ? ' cf-error' : ''}`}>
                  <div className="cf-icon">
                    {isUploading ? <Loader2 size={14} className="progress-spinner" /> : meta.icon}
                  </div>
                  <span className="cf-name" title={cf.name}>{cf.name}</span>
                  <span className={`cf-status ${isError ? 'cf-status-error' : ''}`}>
                    {isUploading ? '上传中…' : isError ? (cf.error || '上传失败') : formatFileSize(cf.size)}
                  </span>
                  <button className="cf-remove" onClick={() => removeContextFile(cf.id)} title="移除">
                    <X size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
