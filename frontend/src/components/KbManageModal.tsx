/**
 * KbManageModal — 知识库管理弹窗
 * 融合上传文件功能 与 知识库列表功能，两个标签在左上角
 * 设计方向：精致的档案柜 — 干净克制的卡片化布局
 */
import { useState, useRef, useCallback, useEffect, type DragEvent } from 'react'
import { Modal, message, Input } from 'antd'
import {
  ReloadOutlined,
  DeleteOutlined,
  SearchOutlined,
  CloudUploadOutlined,
  FileOutlined,
  CloseOutlined,
} from '@ant-design/icons'
import { useChat } from '../store/chatStore'
import { listUploadedFiles, deleteUploadedFile } from '../api/chat'
import type { UploadedFileMeta } from '../api/chat'

// ============================================================
// Props & Types
// ============================================================

interface KbManageModalProps {
  open: boolean
  onClose: () => void
}

type MainTab = 'upload' | 'files'
type ScopeTab = 'public' | 'personal'

// ============================================================
// Shared helpers
// ============================================================

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  } catch {
    return dateStr
  }
}

function fileTypeMeta(filename: string): { icon: string; color: string; label: string } {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, { icon: string; color: string; label: string }> = {
    pdf:  { icon: 'PDF',  color: '#f43f5e', label: 'PDF' },
    docx: { icon: 'DOC',  color: '#3b82f6', label: 'Word' },
    doc:  { icon: 'DOC',  color: '#3b82f6', label: 'Word' },
    xlsx: { icon: 'XLS',  color: '#10b981', label: 'Excel' },
    xls:  { icon: 'XLS',  color: '#10b981', label: 'Excel' },
    csv:  { icon: 'CSV',  color: '#10b981', label: 'CSV' },
    pptx: { icon: 'PPT',  color: '#f59e0b', label: 'PPT' },
    ppt:  { icon: 'PPT',  color: '#f59e0b', label: 'PPT' },
    txt:  { icon: 'TXT',  color: '#6b7280', label: '文本' },
    md:   { icon: 'MD',   color: '#6b7280', label: 'MD' },
    png:  { icon: 'IMG',  color: '#ec4899', label: '图片' },
    jpg:  { icon: 'IMG',  color: '#ec4899', label: '图片' },
    jpeg: { icon: 'IMG',  color: '#ec4899', label: '图片' },
    zip:  { icon: 'ZIP',  color: '#8b5cf6', label: '压缩包' },
    rar:  { icon: 'RAR',  color: '#8b5cf6', label: '压缩包' },
    '7z': { icon: '7Z',   color: '#8b5cf6', label: '压缩包' },
  }
  return map[ext] || { icon: ext.slice(0, 3).toUpperCase() || '?', color: '#9ca3af', label: ext.toUpperCase() }
}

function statusEmoji(status: string): string {
  switch (status) {
    case 'waiting':   return '⏳'
    case 'uploading': return '📤'
    case 'unpacking': return '📦'
    case 'indexing':  return '🔍'
    case 'done':      return '✅'
    case 'error':     return '❌'
    default:          return '⏳'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'waiting':   return '等待上传'
    case 'uploading': return '上传中…'
    case 'unpacking': return '解压中…'
    case 'indexing':  return '索引中…'
    case 'done':      return '已完成'
    case 'error':     return '上传失败'
    default:          return '等待中'
  }
}

// ============================================================
// Shared style constants
// ============================================================

const COLORS = {
  primary:    '#6366f1',
  primaryBg:  '#eef2ff',
  text:       '#1f2937',
  textMuted:  '#9ca3af',
  border:     '#e5e7eb',
  bgHover:    '#f9fafb',
  bgCard:     '#ffffff',
  danger:     '#ef4444',
  dangerBg:   '#fef2f2',
  success:    '#10b981',
  warning:    '#f59e0b',
  white:      '#ffffff',
}

// ============================================================
// UploadSection — 上传文件标签
// ============================================================

function UploadSection() {
  const {
    pendingFiles,
    uploadProgress,
    isUploading,
    addPendingFiles,
    removePendingFile,
    clearPendingFiles,
    clearUploadProgress,
    confirmUpload,
  } = useChat()

  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const justCompletedRef = useRef(false)

  const handleFileSelect = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0 || isUploading) return
      if (justCompletedRef.current) {
        justCompletedRef.current = false
        return
      }
      addPendingFiles(files)
    },
    [addPendingFiles, isUploading],
  )

  const handleDrag = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isUploading) setDragOver(true)
  }
  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }
  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (isUploading) return
    handleFileSelect(e.dataTransfer.files)
  }

  const handleConfirm = async () => {
    await confirmUpload()
    clearPendingFiles()
    justCompletedRef.current = true
    message.success('文件上传成功')
  }

  const isUploadDone = !isUploading && uploadProgress.length > 0 && pendingFiles.length === 0
  const showProgress = isUploading || uploadProgress.length > 0
  const totalCount = showProgress ? uploadProgress.length : pendingFiles.length
  const doneCount = uploadProgress.filter((p) => p.status === 'done').length
  const errCount  = uploadProgress.filter((p) => p.status === 'error').length
  const okCount   = doneCount
  const errList   = uploadProgress.filter((p) => p.status === 'error')
  const resolvedCount = doneCount + errCount

  return (
    <div style={{ paddingTop: 4 }}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => handleFileSelect(e.target.files)}
        accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.csv,.txt,.md,.png,.jpg,.jpeg,.zip,.rar,.7z"
      />

      {/* ---- Upload zone ---- */}
      {!showProgress && (
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '44px 32px',
            border: `2px dashed ${dragOver ? COLORS.primary : '#d1d5db'}`,
            borderRadius: 14,
            background: dragOver
              ? 'linear-gradient(135deg, rgba(99,102,241,0.04) 0%, rgba(99,102,241,0.01) 100%)'
              : 'linear-gradient(135deg, #fafbfc 0%, #f5f6f8 100%)',
            cursor: 'pointer',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            marginBottom: 24,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Decorative subtle radial glow on drag */}
          {dragOver && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: `radial-gradient(circle at 50% 50%, rgba(99,102,241,0.08) 0%, transparent 70%)`,
                pointerEvents: 'none',
              }}
            />
          )}

          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: dragOver ? COLORS.primaryBg : '#f3f4f6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              transform: dragOver ? 'scale(1.05)' : 'scale(1)',
            }}
          >
            <CloudUploadOutlined
              style={{
                fontSize: 24,
                color: dragOver ? COLORS.primary : '#9ca3af',
                transition: 'color 0.3s ease',
              }}
            />
          </div>

          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: dragOver ? COLORS.primary : COLORS.text,
              marginBottom: 6,
              transition: 'color 0.2s ease',
            }}
          >
            拖拽文件到此处，或点击选择
          </div>
          <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.6 }}>
            支持 PDF、Word、Excel、PPT、CSV、TXT、Markdown 等格式
          </div>
        </div>
      )}

      {/* ---- Upload progress ---- */}
      {showProgress && (
        <div style={{ marginBottom: 24 }}>
          {/* During upload — show detailed per-file items */}
          {isUploading ? (
            <>
              {/* Progress summary bar */}
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 8,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>
                    正在上传…
                  </span>
                  <span style={{ fontSize: 12, color: COLORS.textMuted }}>
                    {resolvedCount} / {totalCount}
                  </span>
                </div>
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: '#f3f4f6',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      borderRadius: 3,
                      width: totalCount > 0 ? `${(resolvedCount / totalCount) * 100}%` : '0%',
                      background: COLORS.primary,
                      transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                    }}
                  />
                </div>
              </div>

              {/* Progress items */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {uploadProgress.map((item) => (
                  <div
                    key={item.uid}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 14px',
                      borderRadius: 10,
                      background: COLORS.bgHover,
                      border: `1px solid ${COLORS.border}`,
                    }}
                  >
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{statusEmoji(item.status)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: COLORS.text,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {item.name}
                      </div>
                      <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>
                        {statusLabel(item.status)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            /* Upload finished — compact dismissible summary card */
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 16px',
                borderRadius: 10,
                background: errCount === 0 && okCount > 0 ? '#f0fdf4' : COLORS.dangerBg,
                border: `1px solid ${errCount === 0 && okCount > 0 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}`,
              }}
            >
              <span style={{ fontSize: 18 }}>
                {errCount === 0 && okCount > 0 ? '✅' : errCount > 0 && okCount === 0 ? '❌' : '⚠️'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>
                  {errCount === 0 && okCount > 0
                    ? `上传完成 · ${okCount} 个文件成功`
                    : errCount > 0 && okCount === 0
                      ? '上传失败'
                      : `上传部分完成 · ${okCount}/${totalCount} 成功`}
                </div>
                {errCount > 0 && (
                  <div style={{ fontSize: 11, color: COLORS.danger, marginTop: 2 }}>
                    {errCount} 个文件失败{errList[0] ? `：${errList[0].error}` : ''}
                  </div>
                )}
              </div>
              <button
                onClick={clearUploadProgress}
                style={{
                  background: 'none',
                  border: 'none',
                  color: COLORS.textMuted,
                  cursor: 'pointer',
                  fontSize: 16,
                  padding: '4px 6px',
                  borderRadius: 6,
                  lineHeight: 1,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = COLORS.text; e.currentTarget.style.background = '#f3f4f6' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = COLORS.textMuted; e.currentTarget.style.background = 'none' }}
              >
                ✕
              </button>
            </div>
          )}
        </div>
      )}

      {/* ---- Pending file list ---- */}
      {!showProgress && pendingFiles.length > 0 && (
        <>
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>
                  待上传文件
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: COLORS.primary,
                    background: COLORS.primaryBg,
                    padding: '2px 8px',
                    borderRadius: 10,
                  }}
                >
                  {pendingFiles.length} 个
                </span>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                style={{
                  background: 'none',
                  border: 'none',
                  color: COLORS.primary,
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: 6,
                  fontWeight: 500,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = COLORS.primaryBg }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
              >
                ＋ 继续添加
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                maxHeight: 320,
                overflowY: 'auto',
                paddingRight: 4,
              }}
            >
              {pendingFiles.map((pf) => {
                const { icon, color } = fileTypeMeta(pf.name)
                return (
                  <div
                    key={pf.uid}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 14px',
                      borderRadius: 10,
                      background: COLORS.bgHover,
                      border: `1px solid ${COLORS.border}`,
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f3f4f6'
                      e.currentTarget.style.borderColor = '#d1d5db'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = COLORS.bgHover
                      e.currentTarget.style.borderColor = COLORS.border
                    }}
                  >
                    {/* File type icon */}
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 10,
                        background: `${color}14`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        fontSize: 11,
                        fontWeight: 700,
                        color,
                        letterSpacing: '-0.3px',
                      }}
                    >
                      {icon}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: COLORS.text,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {pf.name}
                      </div>
                      <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>
                        {formatSize(pf.size)}
                        {pf.isArchive && (
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 10,
                              fontWeight: 500,
                              color: '#8b5cf6',
                              background: '#f3f0ff',
                              padding: '1px 8px',
                              borderRadius: 4,
                            }}
                          >
                            压缩包
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => removePendingFile(pf.uid)}
                      disabled={isUploading}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: COLORS.textMuted,
                        cursor: isUploading ? 'not-allowed' : 'pointer',
                        fontSize: 16,
                        padding: '3px 6px',
                        borderRadius: 6,
                        lineHeight: 1,
                        transition: 'all 0.15s ease',
                        flexShrink: 0,
                        opacity: isUploading ? 0.4 : 1,
                      }}
                      onMouseEnter={(e) => {
                        if (!isUploading) {
                          e.currentTarget.style.color = COLORS.danger
                          e.currentTarget.style.background = COLORS.dangerBg
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isUploading) {
                          e.currentTarget.style.color = COLORS.textMuted
                          e.currentTarget.style.background = 'none'
                        }
                      }}
                    >
                      <CloseOutlined />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Confirm button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={handleConfirm}
              disabled={isUploading}
              style={{
                padding: '10px 36px',
                border: 'none',
                borderRadius: 10,
                background: isUploading
                  ? '#d1d5db'
                  : `linear-gradient(135deg, ${COLORS.primary} 0%, #4f46e5 100%)`,
                color: COLORS.white,
                fontSize: 14,
                fontWeight: 600,
                cursor: isUploading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: isUploading
                  ? 'none'
                  : '0 2px 8px rgba(99,102,241,0.25)',
              }}
              onMouseEnter={(e) => {
                if (!isUploading) {
                  e.currentTarget.style.transform = 'translateY(-1px)'
                  e.currentTarget.style.boxShadow = '0 4px 14px rgba(99,102,241,0.35)'
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'none'
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(99,102,241,0.25)'
              }}
            >
              <CloudUploadOutlined style={{ marginRight: 6 }} />
              确认上传
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ============================================================
// FilesSection — 知识库列表标签
// ============================================================

function FilesSection() {
  const [activeTab, setActiveTab] = useState<ScopeTab>('public')
  const [files, setFiles] = useState<UploadedFileMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const getUserId = useCallback(() => {
    return localStorage.getItem('lunjiao_user_id') || 'default'
  }, [])

  const loadFiles = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listUploadedFiles({
        scope: activeTab,
        user_id: getUserId(),
        keyword: keyword || undefined,
      })
      setFiles(data)
    } catch (err) {
      console.error('Failed to load files:', err)
      message.error('加载知识库列表失败')
    } finally {
      setLoading(false)
    }
  }, [activeTab, keyword, getUserId])

  useEffect(() => { loadFiles() }, [loadFiles])

  // Debounced keyword search
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(loadFiles, 300)
    return () => clearTimeout(debounceRef.current)
  }, [keyword, loadFiles])

  const handleRemove = async (file: UploadedFileMeta) => {
    try {
      await deleteUploadedFile(file.file_id, getUserId())
      message.success(`已移除 ${file.file_name}`)
      setFiles((prev) => prev.filter((f) => f.file_id !== file.file_id))
    } catch {
      message.error('移除文件失败')
    }
  }

  const SCOPE_TABS: { key: ScopeTab; label: string }[] = [
    { key: 'public', label: '公用知识库' },
    { key: 'personal', label: '个人知识库' },
  ]

  return (
    <div style={{ paddingTop: 4 }}>
      {/* Toolbar: scope tabs | search + refresh */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        {/* Left: scope pills + count */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              display: 'flex',
              background: '#f3f4f6',
              borderRadius: 10,
              padding: 3,
              gap: 2,
            }}
          >
            {SCOPE_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: '6px 18px',
                  fontSize: 13,
                  fontWeight: activeTab === tab.key ? 600 : 400,
                  color: activeTab === tab.key ? COLORS.primary : COLORS.textMuted,
                  background: activeTab === tab.key ? COLORS.white : 'transparent',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  boxShadow: activeTab === tab.key
                    ? '0 1px 3px rgba(0,0,0,0.06)'
                    : 'none',
                  lineHeight: '20px',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {!loading && (
            <span style={{ fontSize: 12, color: COLORS.textMuted, marginLeft: 4, whiteSpace: 'nowrap' }}>
              {files.length} 个文件
            </span>
          )}
        </div>

        {/* Right: search + refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Input
            placeholder="搜索文件名…"
            prefix={<SearchOutlined style={{ color: COLORS.textMuted, fontSize: 13 }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            allowClear
            size="small"
            style={{ width: 200, borderRadius: 8 }}
          />
          <button
            onClick={loadFiles}
            disabled={loading}
            style={{
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: `1px solid ${COLORS.border}`,
              borderRadius: 8,
              cursor: loading ? 'not-allowed' : 'pointer',
              color: COLORS.textMuted,
              fontSize: 14,
              transition: 'all 0.15s ease',
              opacity: loading ? 0.5 : 1,
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.background = COLORS.bgHover
                e.currentTarget.style.color = COLORS.primary
                e.currentTarget.style.borderColor = COLORS.primary
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'none'
              e.currentTarget.style.color = COLORS.textMuted
              e.currentTarget.style.borderColor = COLORS.border
            }}
          >
            <ReloadOutlined spin={loading} />
          </button>
        </div>
      </div>

      {/* File list */}
      <div style={{ maxHeight: 460, overflowY: 'auto', paddingRight: 4 }}>
        {files.length === 0 && !loading ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '56px 0',
              color: COLORS.textMuted,
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 16,
                background: '#f3f4f6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <FileOutlined style={{ fontSize: 24, color: '#d1d5db' }} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>
              {keyword
                ? `未找到匹配「${keyword}」的文件`
                : activeTab === 'public'
                  ? '公用知识库暂无文件'
                  : '您还没有个人知识库文件'}
            </div>
            <div style={{ fontSize: 11, marginTop: 4 }}>
              {keyword ? '尝试其他关键词' : '上传文件以添加到知识库'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {files.map((file) => {
              const extMeta = fileTypeMeta(file.file_name)
              const ragFailed  = file.rag_status === 'failed'
              const ragPending = file.rag_status === 'pending'
              return (
                <div
                  key={file.file_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 14px',
                    borderRadius: 10,
                    background: 'transparent',
                    border: '1px solid transparent',
                    transition: 'all 0.15s ease',
                    cursor: 'default',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = COLORS.bgHover
                    e.currentTarget.style.borderColor = COLORS.border
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.borderColor = 'transparent'
                  }}
                >
                  {/* File type icon */}
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      background: `${extMeta.color}14`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      fontSize: 11,
                      fontWeight: 700,
                      color: extMeta.color,
                      letterSpacing: '-0.3px',
                    }}
                  >
                    {extMeta.icon}
                  </div>

                  {/* File info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: COLORS.text,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={file.file_name}
                    >
                      {file.file_name}
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>{formatSize(file.file_size)}</span>
                      <span style={{ opacity: 0.4 }}>·</span>
                      <span>{formatDate(file.uploaded_at)}</span>
                      {ragPending && (
                        <span style={{ color: COLORS.warning, fontWeight: 500 }}>索引中…</span>
                      )}
                      {ragFailed && (
                        <span style={{ color: COLORS.danger, fontWeight: 500 }}>索引失败</span>
                      )}
                    </div>
                  </div>

                  {/* Remove button */}
                  <button
                    onClick={() => handleRemove(file)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: COLORS.textMuted,
                      fontSize: 13,
                      padding: '5px',
                      borderRadius: 6,
                      lineHeight: 1,
                      transition: 'all 0.15s ease',
                      flexShrink: 0,
                      opacity: 0,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = COLORS.danger
                      e.currentTarget.style.background = COLORS.dangerBg
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = COLORS.textMuted
                      e.currentTarget.style.background = 'none'
                    }}
                    // Show delete button on the row hover
                    ref={(el) => {
                      if (el) {
                        const row = el.closest('[style]')
                        if (row) {
                          row.addEventListener('mouseenter', () => { el.style.opacity = '1' })
                          row.addEventListener('mouseleave', () => { el.style.opacity = '0' })
                        }
                      }
                    }}
                    title="移除"
                  >
                    <DeleteOutlined />
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

// ============================================================
// KbManageModal — 主弹窗
// ============================================================

export default function KbManageModal({ open, onClose }: KbManageModalProps) {
  const [activeTab, setActiveTab] = useState<MainTab>('upload')

  useEffect(() => {
    if (open) setActiveTab('upload')
  }, [open])

  const MAIN_TABS: { key: MainTab; label: string; icon: string }[] = [
    { key: 'upload', label: '上传文件', icon: '📤' },
    { key: 'files',  label: '知识库列表', icon: '📚' },
  ]

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: 'rgba(255,255,255,0.18)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 17,
              backdropFilter: 'blur(4px)',
            }}
          >
            📂
          </span>
          <span style={{ fontWeight: 700, fontSize: 16, color: '#fff', letterSpacing: '-0.2px' }}>
            知识库管理
          </span>
        </div>
      }
      closeIcon={
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: 7,
            fontSize: 14,
            color: 'rgba(255,255,255,0.7)',
            transition: 'all 0.2s ease',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.12)'
            e.currentTarget.style.color = '#fff'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'rgba(255,255,255,0.7)'
          }}
        >
          ✕
        </span>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={680}
      styles={{
        body: { padding: '20px 28px 28px', minHeight: 360 },
        header: {
          padding: '18px 28px 16px',
          margin: 0,
          borderBottom: 'none',
          background: `linear-gradient(135deg, ${COLORS.primary} 0%, #4f46e5 60%, #4338ca 100%)`,
          borderRadius: '8px 8px 0 0',
        },
      }}
    >
      {/* Main tabs — wrapped in a pill container like scope tabs */}
      <div style={{ marginBottom: 28 }}>
        <div
          style={{
            display: 'inline-flex',
            background: '#f3f4f6',
            borderRadius: 11,
            padding: 4,
            gap: 2,
          }}
        >
          {MAIN_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '7px 20px',
                fontSize: 13,
                fontWeight: activeTab === tab.key ? 600 : 400,
                color: activeTab === tab.key ? COLORS.primary : COLORS.textMuted,
                background: activeTab === tab.key ? COLORS.white : 'transparent',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: activeTab === tab.key ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                lineHeight: '20px',
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {activeTab === 'upload' ? <UploadSection /> : <FilesSection />}
    </Modal>
  )
}
