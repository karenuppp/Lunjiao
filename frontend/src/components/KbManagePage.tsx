import React, { useState, useRef, useCallback } from 'react'
import {
  Input, Button, Table, Modal, Tag, Empty,
  Tooltip, message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { InputRef } from 'antd'
import { useChat } from '../store/chatStore'
import { listUploadedFiles, deleteUploadedFile } from '../api/chat'
import type { UploadedFileMeta } from '../api/chat'

// Lucide icons
import {
  UploadCloud, FileText, FileType, Table2,
  Presentation, Archive, Image as ImageIcon, Loader2, Search, RefreshCw,
  Trash2, XCircle, CheckCircle2, Inbox,
} from 'lucide-react'

// ============================================================
// Helper functions
// ============================================================

function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(iso: string): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

/** File type → { lucideIcon, label, colorClass } */
function getFileTypeMeta(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'pdf':   return { icon: <FileText size={16} />,     label: 'PDF',   colorClass: 'file-red' }
    case 'docx':
    case 'doc':   return { icon: <FileType size={16} />,     label: 'DOC',   colorClass: 'file-blue' }
    case 'xlsx':
    case 'xls':
    case 'csv':   return { icon: <Table2 size={16} />,       label: 'XLS',   colorClass: 'file-green' }
    case 'pptx':  return { icon: <Presentation size={16} />, label: 'PPT',   colorClass: 'file-orange' }
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'tgz':
    case 'tar.gz':return { icon: <Archive size={16} />,      label: ext.toUpperCase(), colorClass: 'file-purple' }
    case 'png':
    case 'jpg':
    case 'jpeg':  return { icon: <ImageIcon size={16} />,    label: 'IMG',   colorClass: 'file-pink' }
    default:      return { icon: <FileText size={16} />,     label: ext.toUpperCase() || '?', colorClass: 'file-gray' }
  }
}

const RAG_STATUS_MAP: Record<string, { color: string; label: string }> = {
  indexed: { color: 'green', label: '已索引' },
  pending: { color: 'orange', label: '索引中' },
  failed:  { color: 'red', label: '索引失败' },
}

// ============================================================
// UploadModal content — drag-drop + pending list + progress
// ============================================================

function UploadModalBody({ onDone }: { onDone: () => void }) {
  const {
    pendingFiles, uploadProgress, isUploading,
    addPendingFiles, removePendingFile, clearPendingFiles,
    confirmUpload,
  } = useChat()

  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const justCompletedRef = useRef(false)

  if (justCompletedRef.current && !isUploading && pendingFiles.length === 0 && uploadProgress.length === 0) {
    justCompletedRef.current = false
  }

  const handleFileSelect = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0 || isUploading) return
      if (justCompletedRef.current) { justCompletedRef.current = false; return }
      addPendingFiles(files)
    },
    [addPendingFiles, isUploading],
  )

  const handleConfirmUpload = async () => {
    await confirmUpload()
    clearPendingFiles()
    message.success('文件上传成功')
    justCompletedRef.current = true
    // Auto-close after a brief moment for the user to see completion
    setTimeout(() => onDone(), 600)
  }

  const showProgress = isUploading || (uploadProgress.length > 0 && pendingFiles.length === 0)

  return (
    <div className="kb-upload-container">
      <div
        onClick={() => { if (!isUploading && !justCompletedRef.current) fileInputRef.current?.click() }}
        onDragEnter={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragOver={(e) => { e.preventDefault() }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFileSelect(e.dataTransfer.files) }}
        className={`kb-upload-zone ${dragOver ? 'drag-over' : ''} ${(isUploading || justCompletedRef.current) ? 'disabled' : ''}`}
      >
        <UploadCloud size={40} className="upload-zone-icon" />
        <div className="zone-title">拖拽文件到此处，或点击选择</div>
        <div className="zone-hint">
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

      {showProgress && (
        <div>
          {uploadProgress.length > 0 && (
            <>
              <div className="kb-overall-progress">
                <div className="overall-bar">
                  <div
                    className="overall-fill"
                    style={{ width: `${(uploadProgress.filter(p => p.status === 'done' || p.status === 'error').length / uploadProgress.length) * 100}%` }}
                  />
                </div>
                <span className="overall-text">
                  {uploadProgress.filter(p => p.status === 'done' || p.status === 'error').length} / {uploadProgress.length}
                </span>
              </div>

              <div className="kb-progress-list">
                {uploadProgress.map((item) => (
                  <div key={item.uid} className={`kb-progress-item ${item.status}`}>
                    <div className="progress-status-icon">
                      {item.status === 'done' && <CheckCircle2 size={16} className="text-success" />}
                      {item.status === 'error' && <XCircle size={16} className="text-error" />}
                      {(item.status !== 'done' && item.status !== 'error') && (
                        <Loader2 size={16} className="progress-spinner" />
                      )}
                    </div>
                    <div className="progress-info">
                      <div className="progress-name">{item.name}</div>
                      {item.status === 'error' && item.error ? (
                        <div className="progress-error">{item.error}</div>
                      ) : (
                        <div className="progress-desc">
                          {item.status === 'waiting' && '等待上传'}
                          {item.status === 'uploading' && '上传中...'}
                          {item.status === 'unpacking' && '解压中...'}
                          {item.status === 'indexing' && '索引中...'}
                          {item.status === 'done' && '完成'}
                        </div>
                      )}
                    </div>
                    {/* Archive children */}
                    {item.archiveChildren && item.archiveChildren.length > 0 && (
                      <div className="kb-archive-children">
                        {item.archiveChildren.map((child, ci) => (
                          <div key={ci} className={`kb-child-item ${child.status}`}>
                            <div className="progress-status-icon">
                              {child.status === 'done' && <CheckCircle2 size={12} className="text-success" />}
                              {child.status === 'error' && <XCircle size={12} className="text-error" />}
                            </div>
                            <div className="progress-info">
                              <div className="progress-name">{child.name}</div>
                              {child.error && <div className="progress-error">{child.error}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {!showProgress && pendingFiles.length > 0 && (
        <>
          <div className="section-header">
            <span className="section-title">待上传文件 ({pendingFiles.length} 个)</span>
          </div>

          <div className="kb-pending-list" style={{ maxHeight: '200px' }}>
            {pendingFiles.map((pf) => {
              const meta = getFileTypeMeta(pf.name)
              return (
                <div key={pf.uid} className="kb-pending-item">
                  <div className={`file-icon ${meta.colorClass}`}>{meta.icon}</div>
                  <div className="file-info">
                    <div className="file-name">{pf.name}</div>
                    <div className="file-size">
                      {formatSize(pf.size)}{pf.isArchive && ' · 压缩包'}
                    </div>
                  </div>
                  <button
                    onClick={() => removePendingFile(pf.uid)}
                    disabled={isUploading}
                    className={`remove-btn ${isUploading ? 'disabled' : ''}`}
                    title="移除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={handleConfirmUpload} disabled={isUploading} className="confirm-btn">
              {isUploading ? (
                <><Loader2 size={14} className="progress-spinner" /> 上传中...</>
              ) : '确认上传'}
            </button>
          </div>
        </>
      )}

      {!showProgress && pendingFiles.length === 0 && uploadProgress.length === 0 && (
        <div className="empty-state">
          <Inbox size={36} className="empty-icon" />
          <div style={{ fontSize: 13, color: '#9CA3AF' }}>拖拽文件或点击上方区域选择文件</div>
        </div>
      )}
    </div>
  )
}


// ============================================================
// Main component
// ============================================================

export default function KbManagePage() {
  const role = localStorage.getItem('lunjiao_role') || ''
  const isAdmin = role === 'admin'
  const userId = localStorage.getItem('lunjiao_user_id') || 'default'

  const [searchKeyword, setSearchKeyword] = useState('')
  const [scope, setScope] = useState<'all' | 'public' | 'personal'>('personal')

  const [uploadOpen, setUploadOpen] = useState(false)

  const [files, setFiles] = useState<UploadedFileMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  const searchInputRef = useRef<InputRef>(null)

  const renderFileIcon = (name: string) => {
    const meta = getFileTypeMeta(name)
    return <div className={`file-icon file-icon-sm ${meta.colorClass}`}>{meta.icon}</div>
  }

  const loadFiles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const all = await listUploadedFiles({ user_id: userId })
      setFiles(all)
      setSelectedRowKeys([])
    } catch {
      setError('加载文件列表失败')
    } finally {
      setLoading(false)
    }
  }, [userId])

  React.useEffect(() => { loadFiles() }, [loadFiles])

  const scopedFiles = (() => {
    let filtered = files
    if (scope === 'public') {
      filtered = filtered.filter(f => f.user_id === 'default')
    } else if (scope === 'personal') {
      filtered = filtered.filter(f => f.user_id !== 'default')
    }
    if (searchKeyword) {
      const kw = searchKeyword.toLowerCase()
      filtered = filtered.filter(f => f.file_name.toLowerCase().includes(kw))
    }
    return filtered
  })()

  const handleDelete = async (fileId: string) => {
    setDeletingId(fileId)
    try {
      await deleteUploadedFile(fileId, userId)
      setFiles(prev => prev.filter(f => f.file_id !== fileId))
      setSelectedRowKeys(prev => prev.filter(k => k !== fileId))
      message.success('文件已删除')
    } catch {
      message.error('删除失败')
    } finally {
      setDeletingId(null)
    }
  }

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) return
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 个文件吗？此操作不可恢复。`,
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        let successCount = 0
        for (const fileId of selectedRowKeys) {
          try {
            await deleteUploadedFile(fileId as string, userId)
            setFiles(prev => prev.filter(f => f.file_id !== fileId))
            successCount++
          } catch {
            // continue
          }
        }
        setSelectedRowKeys([])
        if (successCount > 0) message.success(`成功删除 ${successCount} 个文件`)
      },
    })
  }

  const columns: ColumnsType<UploadedFileMeta> = [
    {
      title: '文件名',
      dataIndex: 'file_name',
      key: 'file_name',
      width: 260,
      render: (name: string) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ flexShrink: 0 }}>{renderFileIcon(name)}</span>
          <span className="file-name" style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{name}</span>
        </div>
      ),
      sorter: (a, b) => a.file_name.localeCompare(b.file_name),
    },
    {
      title: '大小',
      dataIndex: 'file_size',
      key: 'file_size',
      width: 100,
      render: (size: number) => <span style={{ color: '#6B7280', fontSize: 13 }}>{formatSize(size)}</span>,
      sorter: (a, b) => a.file_size - b.file_size,
    },
    {
      title: '状态',
      dataIndex: 'rag_status',
      key: 'rag_status',
      width: 110,
      render: (status: string) => {
        const cfg = RAG_STATUS_MAP[status] || { color: 'default', label: status }
        return <Tag color={cfg.color}>{cfg.label}</Tag>
      },
      filters: [
        { text: '已索引', value: 'indexed' },
        { text: '索引中', value: 'pending' },
        { text: '索引失败', value: 'failed' },
      ],
      onFilter: (value, record) => record.rag_status === value,
    },
    {
      title: '上传时间',
      dataIndex: 'uploaded_at',
      key: 'uploaded_at',
      width: 160,
      render: (time: string) => <span style={{ color: '#9CA3AF', fontSize: 12 }}>{formatTime(time)}</span>,
      sorter: (a, b) => new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime(),
      defaultSortOrder: 'descend',
    },
    {
      title: '来源',
      dataIndex: 'user_id',
      key: 'user_id',
      width: 90,
      render: (uid: string) => (
        <Tag style={{ fontSize: 11 }} color={uid === 'default' ? 'blue' : 'default'}>
          {uid === 'default' ? '公用' : '个人'}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: unknown, record: UploadedFileMeta) => (
        <Tooltip title="删除">
          <Button
            type="text" size="small" danger
            icon={<Trash2 size={14} />}
            loading={deletingId === record.file_id}
            onClick={() => handleDelete(record.file_id)}
          />
        </Tooltip>
      ),
    },
  ]

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
  }

  return (
    <div style={{ height: '100%', padding: '32px', overflow: 'auto' }}>
      {/* Single card: toolbar + file table */}
      <div className="page-card">
        <h3 className="page-card-heading">文件管理</h3>

        {/* Row 1: scope toggle (left) + action buttons (right) — same row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {isAdmin && (
              <div className="scope-toggle">
                <button onClick={() => setScope('personal')} className={scope === 'personal' ? 'active' : ''}>个人</button>
                <button onClick={() => setScope('public')} className={scope === 'public' ? 'active' : ''}>公用</button>
                <button onClick={() => setScope('all')} className={scope === 'all' ? 'active' : ''}>全部</button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button size="middle" icon={<RefreshCw size={14} />} onClick={loadFiles} loading={loading}>
              刷新
            </Button>

            <Button type="primary" size="middle" icon={<UploadCloud size={14} />} onClick={() => setUploadOpen(true)}>
              上传文件
            </Button>

            {selectedRowKeys.length > 0 && (
              <Button size="middle" danger icon={<Trash2 size={14} />} onClick={handleBatchDelete}>
                删除 ({selectedRowKeys.length})
              </Button>
            )}
          </div>
        </div>

        {/* Row 2: file list heading (left) + search (right) — same line */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 className="page-card-heading" style={{ margin: 0 }}>
            文件列表（{scopedFiles.length}）
          </h3>
          <Input
            ref={searchInputRef}
            placeholder="搜索文件名…"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            prefix={<Search size={14} style={{ color: '#9CA3AF' }} />}
            size="middle"
            style={{ width: 220 }}
            allowClear
          />
        </div>

        <Table<UploadedFileMeta>
          dataSource={scopedFiles}
          columns={columns}
          rowKey="file_id"
          loading={loading}
          rowSelection={isAdmin ? rowSelection : undefined}
          size="small"
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
            showTotal: (total, range) => `${range[0]}-${range[1]} / 共 ${total} 个文件`,
            size: 'small',
          }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <div>
                    <div style={{ color: '#9CA3AF', marginBottom: 12 }}>暂无已上传文件</div>
                    <Button type="primary" size="middle" icon={<UploadCloud size={14} />} onClick={() => setUploadOpen(true)}>
                      上传第一个文件
                    </Button>
                  </div>
                }
              />
            ),
          }}
        />
        {error && !loading && (
          <div style={{ textAlign: 'center', padding: 24, color: '#EF4444' }}>{error}</div>
        )}
      </div>

      <Modal
        title="上传文件"
        open={uploadOpen}
        onCancel={() => setUploadOpen(false)}
        footer={null}
        width={640}
        destroyOnClose
        styles={{ body: { maxHeight: '60vh', overflowY: 'auto' } }}
      >
        <UploadModalBody onDone={() => { setUploadOpen(false); loadFiles() }} />
      </Modal>
    </div>
  )
}
