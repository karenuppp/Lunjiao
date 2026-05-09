/**
 * KbManagePage — 知识库管理页面
 * Two tabs: 上传新文件 (KbUploadTab) / 已上传文件 (KbFilesTab)
 */

import React, { useState, useRef, useCallback, type DragEvent } from 'react'
import { message } from 'antd'
import { useChat } from '../store/chatStore'
import { listUploadedFiles, deleteUploadedFile } from '../api/chat'
import type { KbTab, PendingFile, UploadProgressItem } from '../types/chat'

// ============================================================
// Helpers
// ============================================================

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileTypeIcon(filename: string): { icon: string; color: string } {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, { icon: string; color: string }> = {
    pdf: { icon: 'PDF', color: '#ef4444' },
    docx: { icon: 'DOC', color: '#3b82f6' },
    xlsx: { icon: 'XLS', color: '#22c55e' },
    csv: { icon: 'CSV', color: '#22c55e' },
    pptx: { icon: 'PPT', color: '#f97316' },
    txt: { icon: 'TXT', color: '#6b7280' },
    md: { icon: 'MD', color: '#6b7280' },
    zip: { icon: 'ZIP', color: '#8b5cf6' },
    rar: { icon: 'RAR', color: '#8b5cf6' },
    '7z': { icon: '7Z', color: '#8b5cf6' },
    png: { icon: 'IMG', color: '#ec4899' },
    jpg: { icon: 'IMG', color: '#ec4899' },
    jpeg: { icon: 'IMG', color: '#ec4899' },
    tar: { icon: 'TAR', color: '#8b5cf6' },
  }
  return map[ext] || { icon: ext.slice(0, 3).toUpperCase() || '?', color: '#9ca3af' }
}

function statusEmoji(status: string): string {
  switch (status) {
    case 'waiting': return '⏳'
    case 'uploading': return '📤'
    case 'unpacking': return '📦'
    case 'indexing': return '🔍'
    case 'done': return '✅'
    case 'error': return '❌'
    default: return '⏳'
  }
}

// ============================================================
// KbFilesTab — list/browse/delete uploaded files
// ============================================================

function KbFilesTab() {
  const { uploadedFiles, removeUploadedFile } = useChat()
  const [deleting, setDeleting] = useState<string | null>(null)

  const handleDelete = async (fileId: string) => {
    setDeleting(fileId)
    try {
      const userId = localStorage.getItem('lunjiao_user_id') || 'default'
      await deleteUploadedFile(fileId, userId)
      removeUploadedFile(fileId)
      message.success('文件已删除')
    } catch {
      message.error('删除失败')
    } finally {
      setDeleting(null)
    }
  }

  if (uploadedFiles.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: '#9ca3af', padding: '60px 0' }}>
        <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.4 }}>📭</div>
        <div style={{ fontSize: 14 }}>暂无已上传文件</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {uploadedFiles.map((f) => {
        const { icon, color } = fileTypeIcon(f.fileName)
        return (
          <div
            key={f.fileId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 14px',
              borderRadius: 8,
              background: '#f9fafb',
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                background: color,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#1a1b2e',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {f.fileName}
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>
                {formatSize(f.fileSize)} · {f.ragStatus === 'indexed' ? '已索引' : f.ragStatus}
              </div>
            </div>
            <button
              onClick={() => handleDelete(f.fileId)}
              disabled={deleting === f.fileId}
              style={{
                background: 'none',
                border: 'none',
                color: deleting === f.fileId ? '#d1d5db' : '#9ca3af',
                cursor: deleting === f.fileId ? 'not-allowed' : 'pointer',
                fontSize: 16,
                padding: '2px 4px',
                borderRadius: 4,
                lineHeight: 1,
              }}
              onMouseEnter={(e) => {
                if (deleting !== f.fileId) e.currentTarget.style.color = '#ef4444'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#9ca3af'
              }}
            >
              {deleting === f.fileId ? '⏳' : '✕'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ============================================================
// KbUploadTab — drag-zone, pending list, confirm, progress
// ============================================================

function KbUploadTab() {
  const {
    pendingFiles,
    uploadProgress,
    isUploading,
    addPendingFiles,
    removePendingFile,
    clearPendingFiles,
    confirmUpload,
  } = useChat()

  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const justCompletedRef = useRef(false)

  const handleFileSelect = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0 || isUploading) return
      // Ignore if user just completed a batch upload (file input cached)
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

  // Progressive UI: show progress when uploading, otherwise show pending
  const showProgress = isUploading || (uploadProgress.length > 0 && pendingFiles.length === 0)

  return (
    <div>
      {/* ----- Drag / Select zone ----- */}
      <div
        className={`kb-upload-zone${dragOver ? ' drag-over' : ''}`}
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="kb-upload-zone-icon">📂</div>
        <div className="zone-title">拖拽文件到此处，或点击选择</div>
        <div className="zone-hint">
          支持 PDF、Word、Excel、PPT、CSV、TXT、Markdown 等格式
          <br />
          压缩包（.zip/.rar/.7z/.tar.gz）将自动解压
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => handleFileSelect(e.target.files)}
        accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.csv,.txt,.md,.zip,.rar,.7z,.tar.gz,.tgz,.png,.jpg,.jpeg"
      />

      {/* ----- Progress display ----- */}
      {showProgress && (
        <div className="kb-progress-section">
          <div className="kb-overall-progress">
            <div className="overall-bar">
              <div
                className="overall-fill"
                style={{
                  width: `${uploadProgress.length > 0
                    ? (uploadProgress.filter((p) => p.status === 'done' || p.status === 'error').length / uploadProgress.length) * 100
                    : 0}%`,
                }}
              />
            </div>
            <span className="overall-text">
              {uploadProgress.filter((p) => p.status === 'done' || p.status === 'error').length}/{uploadProgress.length}
            </span>
          </div>
          <div className="kb-progress-list">
            {uploadProgress.map((item) => (
              <div
                key={item.uid}
                className={`kb-progress-item ${item.status === 'done' ? 'done' : ''} ${item.status === 'error' ? 'error' : ''}`}
              >
                <span className="progress-status">{statusEmoji(item.status)}</span>
                <div className="progress-info">
                  <div className="progress-name">{item.name}</div>
                  {item.status === 'error' && item.error && (
                    <div className="progress-desc" style={{ color: '#ef4444' }}>{item.error}</div>
                  )}
                  {item.status !== 'error' && (
                    <div className="progress-desc">
                      {item.status === 'waiting' && '等待上传'}
                      {item.status === 'uploading' && '上传中...'}
                      {item.status === 'unpacking' && '解压中...'}
                      {item.status === 'indexing' && '索引中...'}
                      {item.status === 'done' && '完成'}
                    </div>
                  )}
                </div>
                <div className="progress-bar-wrap">
                  <div
                    className="progress-bar-fill"
                    style={{ width: item.status === 'done' || item.status === 'error' ? '100%' : '0%' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ----- Pending file list ----- */}
      {!showProgress && pendingFiles.length > 0 && (
        <>
          <div className="kb-pending-section">
            <div className="section-header">
              <span className="section-title">待上传文件</span>
              <span className="section-count">{pendingFiles.length} 个文件</span>
            </div>
            <div className="kb-pending-list">
              {pendingFiles.map((pf) => {
                const { icon, color } = fileTypeIcon(pf.name)
                return (
                  <div key={pf.uid} className="kb-pending-item">
                    <div className="file-icon" style={{ background: color }}>
                      {icon}
                    </div>
                    <div className="file-info">
                      <div className="file-name">{pf.name}</div>
                      <div className="file-size">
                        {formatSize(pf.size)}
                        {pf.isArchive && <span className="file-badge">压缩包</span>}
                      </div>
                    </div>
                    <button
                      className="remove-btn"
                      onClick={() => removePendingFile(pf.uid)}
                      disabled={isUploading}
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="kb-confirm-row">
            <button className="kb-confirm-btn" onClick={handleConfirm} disabled={isUploading}>
              确认上传
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ============================================================
// KbManagePage — Tab container
// ============================================================

export default function KbManagePage() {
  const [activeTab, setActiveTab] = useState<KbTab>('upload')

  return (
    <div className="kb-page">
      <div className="kb-header">
        <h1>📂 知识库管理</h1>
        <div className="kb-tabs">
          <button
            className={`kb-tab${activeTab === 'upload' ? ' active' : ''}`}
            onClick={() => setActiveTab('upload')}
          >
            上传新文件
          </button>
          <button
            className={`kb-tab${activeTab === 'files' ? ' active' : ''}`}
            onClick={() => setActiveTab('files')}
          >
            已上传文件
          </button>
        </div>
      </div>
      <div className="kb-content">
        {activeTab === 'upload' ? <KbUploadTab /> : <KbFilesTab />}
      </div>
    </div>
  )
}
