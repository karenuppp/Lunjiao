import { useState, useEffect, useCallback } from 'react'
import { Modal, Button, Spin, Empty, message } from 'antd'
import { ReloadOutlined, DeleteOutlined, FileOutlined } from '@ant-design/icons'
import { listUploadedFiles, deleteUploadedFile } from '../api/chat'
import type { UploadedFileMeta } from '../api/chat'

// ============================================================
// File type icon mapping
// ============================================================

const fileTypeIcons: Record<string, { color: string; label: string }> = {
  pdf: { color: '#E74C3C', label: 'PDF' },
  doc: { color: '#2B7BDF', label: 'DOC' },
  docx: { color: '#2B7BDF', label: 'DOCX' },
  xls: { color: '#27AE60', label: 'XLS' },
  xlsx: { color: '#27AE60', label: 'XLSX' },
  csv: { color: '#1ABC9C', label: 'CSV' },
  pptx: { color: '#E67E22', label: 'PPTX' },
  txt: { color: '#95A5A6', label: 'TXT' },
  md: { color: '#3498DB', label: 'MD' },
  png: { color: '#9B59B6', label: 'PNG' },
  jpg: { color: '#E67E22', label: 'JPG' },
  jpeg: { color: '#E67E22', label: 'JPEG' },
}

function getFileType(meta: UploadedFileMeta): string {
  return (meta.file_type || meta.file_name.split('.').pop() || '').toLowerCase()
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ============================================================
// Props
// ============================================================

interface KbListModalProps {
  open: boolean
  onClose: () => void
}

// ============================================================
// Component
// ============================================================

export default function KbListModal({ open, onClose }: KbListModalProps) {
  const [files, setFiles] = useState<UploadedFileMeta[]>([])
  const [loading, setLoading] = useState(false)

  const loadFiles = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listUploadedFiles()
      setFiles(data)
    } catch (err) {
      console.error('Failed to load files:', err)
      message.error('加载知识库列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) loadFiles()
  }, [open, loadFiles])

  const handleRemove = async (file: UploadedFileMeta) => {
    try {
      await deleteUploadedFile(file.file_id)
      message.success(`已移除 ${file.file_name}`)
      setFiles((prev) => prev.filter((f) => f.file_id !== file.file_id))
    } catch (err) {
      console.error('Failed to delete file:', err)
      message.error('移除文件失败')
    }
  }

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 15 }}>
          <FileOutlined style={{ color: '#6366f1' }} />
          <span>知识库列表</span>
          {!loading && (
            <span style={{ color: '#9ca3af', fontWeight: 400, fontSize: 13, marginLeft: 4 }}>
              {files.length} 个文件
            </span>
          )}
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={
        <Button icon={<ReloadOutlined />} onClick={loadFiles} loading={loading}>
          刷新状态
        </Button>
      }
      width={560}
      styles={{ body: { padding: '16px 24px', minHeight: 100 } }}
    >
      <Spin spinning={loading}>
        {files.length === 0 && !loading ? (
          <Empty
            description="知识库中暂无文件"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ margin: '40px 0' }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {files.map((file) => {
              const ext = getFileType(file)
              const icon = fileTypeIcons[ext] || { color: '#95A5A6', label: ext.toUpperCase() }
              return (
                <div
                  key={file.file_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 8,
                    transition: 'background 0.15s ease',
                    cursor: 'default',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f7' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  {/* File type icon */}
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      background: `${icon.color}18`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      fontSize: 11,
                      fontWeight: 700,
                      color: icon.color,
                      letterSpacing: 0.3,
                    }}
                  >
                    {icon.label}
                  </div>

                  {/* File name and size */}
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
                      title={file.file_name}
                    >
                      {file.file_name}
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                      {formatFileSize(file.file_size)}
                      {file.rag_status === 'pending' && (
                        <span style={{ color: '#f39c12', marginLeft: 8 }}>索引中…</span>
                      )}
                      {file.rag_status === 'failed' && (
                        <span style={{ color: '#e74c3c', marginLeft: 8 }}>索引失败</span>
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
                      color: '#9ca3af',
                      fontSize: 14,
                      padding: '4px 6px',
                      borderRadius: 4,
                      lineHeight: 1,
                      transition: 'all 0.15s ease',
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#ef4444'
                      e.currentTarget.style.background = '#fef2f2'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#9ca3af'
                      e.currentTarget.style.background = 'none'
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
      </Spin>
    </Modal>
  )
}
