/**
 * KbManagePage — 知识库管理弹窗
 *
 * Two tabs at top-left:
 *   - 上传文件 (Upload): drag-drop + pending list + progress
 *   - 知识库列表 (Files): public/personal scope, search, refresh, delete
 */

import React, { useState, useRef, useCallback } from 'react'
import { Modal, message } from 'antd'
import { useChat } from '../store/chatStore'
import { listUploadedFiles, deleteUploadedFile } from '../api/chat'
import type { PendingFile, UploadProgressItem } from '../types/chat'

// ============================================================
// Helper functions for size formatting and file type detection
// ============================================================

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileTypeIcon(filename: string): { icon: string; color: string } {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, { icon: string; color: string }> = {
    pdf:   { icon: 'PDF', color: '#ef4444' },
    docx:  { icon: 'DOC', color: '#3b82f6' },
    xlsx:  { icon: 'XLS', color: '#22c55e' },
    csv:   { icon: 'CSV', color: '#22c55e' },
    pptx:  { icon: 'PPT', color: '#f97316' },
    txt:   { icon: 'TXT', color: '#6b7280' },
    md:    { icon: 'MD', color: '#6b7280' },
    zip:   { icon: 'ZIP', color: '#8b5cf6' },
    rar:   { icon: 'RAR', color: '#8b5cf6' },
    '7z':  { icon: '7Z', color: '#8b5cf6' },
    png:   { icon: 'IMG', color: '#ec4899' },
    jpg:   { icon: 'IMG', color: '#ec4899' },
    jpeg:  { icon: 'IMG', color: '#ec4899' },
    tar:   { icon: 'TAR', color: '#8b5cf6' },
  }
  return map[ext] || { icon: ext.slice(0, 3).toUpperCase() || '?', color: '#9ca3af' }
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

// ============================================================
// Upload tab — drag-drop + pending list + progress display
// ============================================================

function KbUploadTab() {
  const {
    pendingFiles, uploadProgress, isUploading,
    addPendingFiles, removePendingFile, clearPendingFiles,
    clearUploadProgress, confirmUpload,
  } = useChat()

  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const justCompletedRef = useRef(false)

  // Prevent cached file-input events from re-triggering after upload completes
  if (justCompletedRef.current && !isUploading && pendingFiles.length === 0 && uploadProgress.length === 0) {
    justCompletedRef.current = false
  }

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

  const handleConfirmUpload = async () => {
    await confirmUpload()
    clearPendingFiles()
    // Progress stays visible until user closes/switches — don't clear it here.
    message.success('文件上传成功')
  }

  // Decide what to render: progress during upload, pending list before upload
  const showProgress = isUploading || (uploadProgress.length > 0 && pendingFiles.length === 0)

  return (
    <div style={{ maxWidth: 480 }}>
      {/* Drag / Select zone */}
      <div
        onClick={() => { if (!isUploading && !justCompletedRef.current) fileInputRef.current?.click() }}
        onDragEnter={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragOver={(e) => { e.preventDefault() }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFileSelect(e.dataTransfer.files) }}
        style={{
          border: '2px dashed',
          borderColor: dragOver ? '#6366f1' : '#d1d5db',
          borderRadius: 8,
          padding: '40px 20px',
          textAlign: 'center',
          cursor: isUploading || justCompletedRef.current ? 'not-allowed' : 'pointer',
          marginBottom: 16,
          background: dragOver ? '#eef2ff' : '#fff',
          opacity: (isUploading || justCompletedRef.current) ? 0.6 : 1,
        }}
      >
        <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
        <div style={{ fontSize: 14, color: '#374151', fontWeight: 500 }}>拖拽文件到此处，或点击选择</div>
        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 8, lineHeight: 1.6 }}>
          支持 PDF、Word、Excel、PPT、CSV、TXT、Markdown 等格式<br />
          压缩包（.zip/.rar/.7z）将自动解压
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file" multiple hidden
        accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.csv,.txt,.md,.zip,.rar,.7z,.tar.gz,.tgz,.png,.jpg,.jpeg"
        onChange={(e) => handleFileSelect(e.target.files)}
      />

      {/* Progress display (during/after upload) */}
      {showProgress && (
        <div>
          {uploadProgress.length > 0 && (
            <>
              <div style={{ marginBottom: 8 }}>
                <div style={{ height: 4, background: '#e5e7eb', borderRadius: 2, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${(uploadProgress.filter(p => p.status === 'done' || p.status === 'error').length / uploadProgress.length) * 100}%`,
                      height: '100%', background: '#6366f1', borderRadius: 2, transition: 'width .3s',
                    }}
                  />
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'right', marginTop: 4 }}>
                  {uploadProgress.filter(p => p.status === 'done' || p.status === 'error').length} / {uploadProgress.length}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {uploadProgress.map((item) => (
                  <div key={item.uid} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, background: '#f9fafb',
                  }}>
                    <span>{statusEmoji(item.status)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: '#1a1b2e', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                      {item.status === 'error' && item.error ? (
                        <div style={{ fontSize: 11, color: '#ef4444' }}>{item.error}</div>
                      ) : (
                        <div style={{ fontSize: 11, color: '#9ca3af' }}>
                          {item.status === 'waiting' && '等待上传'}
                          {item.status === 'uploading' && '上传中...'}
                          {item.status === 'unpacking' && '解压中...'}
                          {item.status === 'indexing' && '索引中...'}
                          {item.status === 'done' && '完成'}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Pending file list (before upload) */}
      {!showProgress && pendingFiles.length > 0 && (
        <>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 8 }}>待上传文件 ({pendingFiles.length} 个)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {pendingFiles.map((pf) => {
                const { icon, color } = fileTypeIcon(pf.name)
                return (
                  <div key={pf.uid} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 6, background: '#f9fafb',
                  }}>
                    <div style={{ width: 28, height: 28, borderRadius: 4, background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: '#1a1b2e', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pf.name}</div>
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>
                        {formatSize(pf.size)}{pf.isArchive && ' · 📦压缩包'}
                      </div>
                    </div>
                    <button onClick={() => removePendingFile(pf.uid)} disabled={isUploading} style={{
                      background: 'none', border: 'none', color: '#9ca3af', cursor: isUploading ? 'not-allowed' : 'pointer', fontSize: 14,
                    }}>✕</button>
                  </div>
                )
              })}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={handleConfirmUpload} disabled={isUploading} style={{
              padding: '6px 20px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff',
              cursor: isUploading ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 500,
            }}>{isUploading ? '上传中...' : '确认上传'}</button>
          </div>
        </>
      )}

      {/* Empty state */}
      {!showProgress && pendingFiles.length === 0 && uploadProgress.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af' }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.4 }}>📭</div>
          <div style={{ fontSize: 14 }}>暂无待上传文件</div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Files tab — scope tabs + search + file list with delete
// ============================================================

function KbFilesTab() {
  const role = localStorage.getItem('lunjiao_role') || ''
  const isAdmin = role === 'admin'
  const userId = localStorage.getItem('lunjiao_user_id') || 'default'

  const [scope, setScope] = useState<'public' | 'personal'>('personal')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [files, setFiles] = useState<Array<{ file_id: string; file_name: string; file_size: number; user_id?: string }>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadFiles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const all = await listUploadedFiles({ user_id: userId })
      setFiles(all)
    } catch {
      setError('加载文件列表失败')
    } finally {
      setLoading(false)
    }
  }, [userId])

  // Load on mount and scope change
  React.useEffect(() => { loadFiles() }, [loadFiles])

  const scopedFiles = isAdmin && scope === 'public'
    ? files.filter(f => f.user_id === 'default')
    : files.filter(f => f.user_id !== 'default' || (!isAdmin))

  const filteredFiles = searchKeyword
    ? scopedFiles.filter(f =>
        f.file_name.toLowerCase().includes(searchKeyword.toLowerCase()) ||
        (f.user_id && f.user_id.includes(searchKeyword)),
      )
    : scopedFiles

  const handleDelete = async (fileId: string) => {
    // Non-admins can only delete their own files
    if (!isAdmin) {
      message.error('无权删除其他用户的文件')
      return
    }
    setDeletingId(fileId)
    try {
      await deleteUploadedFile(fileId, userId)
      setFiles(prev => prev.filter(f => f.file_id !== fileId))
      message.success('文件已删除')
    } catch {
      message.error('删除失败')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div style={{ maxWidth: 520 }}>
      {/* Search + scope tabs + refresh */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input type="text" placeholder="搜索文件名..." value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)}
          style={{ padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none', flex: 1, minWidth: 120 }} />
        {isAdmin && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setScope('personal')}
              style={{ padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: scope === 'personal' ? 600 : 400, background: scope === 'personal' ? '#eef2ff' : '#f3f4f6', color: scope === 'personal' ? '#6366f1' : '#6b7280' }}>
              个人
            </button>
            <button onClick={() => setScope('public')}
              style={{ padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: scope === 'public' ? 600 : 400, background: scope === 'public' ? '#eef2ff' : '#f3f4f6', color: scope === 'public' ? '#6366f1' : '#6b7280' }}>
              公用
            </button>
          </div>
        )}
        <button onClick={loadFiles} disabled={loading} style={{ padding: '4px 10px', border: 'none', background: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 16, opacity: loading ? 0.5 : 1 }}>🔄</button>
      </div>

      {/* File list */}
      {loading && <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>加载中...</div>}
      {error && !loading && <div style={{ textAlign: 'center', padding: 40, color: '#ef4444' }}>{error}</div>}

      {!loading && filteredFiles.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#9ca3af' }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.4 }}>📭</div>
          <div style={{ fontSize: 14 }}>暂无已上传文件</div>
        </div>
      )}

      {!loading && filteredFiles.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filteredFiles.map((f) => {
            const { icon, color } = fileTypeIcon(f.file_name)
            return (
              <div key={f.file_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 8, background: '#f9fafb' }}>
                <div style={{ width: 32, height: 32, borderRadius: 6, background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1b2e', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.file_name}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>
                    {formatSize(f.file_size)} · {(isAdmin ? (f.user_id === 'default' ? '公用' : f.user_id) : '个人')}
                  </div>
                </div>
                <button onClick={() => handleDelete(f.file_id)} disabled={deletingId === f.file_id} style={{
                  background: 'none', border: 'none', color: deletingId === f.file_id ? '#d1d5db' : '#9ca3af',
                  cursor: (deletingId === f.file_id) ? 'not-allowed' : 'pointer', fontSize: 16, padding: '2px 4px', borderRadius: 4,
                }} onMouseEnter={(e) => { if (deletingId !== f.file_id) e.currentTarget.style.color = '#ef4444' }}
                   onMouseLeave={(e) => { e.currentTarget.style.color = '#9ca3af' }}>
                  {deletingId === f.file_id ? '⏳' : '✕'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ============================================================
// Main component — Modal with two top-left tabs
// ============================================================

export default function KbManagePage({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'upload' | 'files'>('upload')

  return (
    <Modal
      title="📂 知识库管理"
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
    >
      {/* Top-left tab pills */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 16 }}>
        <button onClick={() => setActiveTab('upload')} style={{
          padding: '6px 14px', borderRadius: '8px 0 0 8px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: activeTab === 'upload' ? 600 : 400,
          background: activeTab === 'upload' ? '#6366f1' : '#f3f4f6', color: activeTab === 'upload' ? '#fff' : '#6b7280',
        }}>上传文件</button>
        <button onClick={() => setActiveTab('files')} style={{
          padding: '6px 14px', borderRadius: '0 8px 8px 0', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: activeTab === 'files' ? 600 : 400,
          background: activeTab === 'files' ? '#6366f1' : '#f3f4f6', color: activeTab === 'files' ? '#fff' : '#6b7280',
        }}>知识库列表</button>
      </div>

      <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16, minHeight: 320 }}>
        {activeTab === 'upload' ? <KbUploadTab /> : <KbFilesTab />}
      </div>
    </Modal>
  )
}
