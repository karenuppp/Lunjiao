import React, { useState, useRef, useCallback, useEffect } from 'react'
import {
  Input, Button, Table, Modal, Tag, Empty,
  Tooltip, Select,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { InputRef } from 'antd'
import { useChat } from '../store/chatStore'
import { useToast } from './Toast'
import { listUploadedFiles, deleteUploadedFile, updateFileCategory, listPromptTemplates } from '../api/chat'
import type { UploadedFileMeta, PromptTemplate } from '../api/chat'

import {
  UploadCloud, FileText, FileType, Table2,
  Presentation, Image as ImageIcon, Loader2, Search, RefreshCw,
  Trash2, XCircle, CheckCircle2, Inbox,
  Check,
} from 'lucide-react'

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

function UploadModalBody({ onDone, scope }: { onDone: () => void; scope: 'all' | 'public' | 'personal' }) {
  const {
    pendingFiles, uploadProgress, isUploading,
    addPendingFiles, removePendingFile, clearPendingFiles, clearUploadProgress,
    confirmUpload,
  } = useChat()
  const toast = useToast()

  // Clear stale upload state on mount
  useEffect(() => {
    clearPendingFiles()
    clearUploadProgress()
  }, [])

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
    const targetUserId = scope === 'public' ? 'default' : undefined
    await confirmUpload(targetUserId)
    clearPendingFiles()
    toast.success('上传成功')
    justCompletedRef.current = true
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
          支持 PDF、Word、Excel、CSV、TXT、Markdown 等格式
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file" multiple hidden
        accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md"
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
                      {formatSize(pf.size)}
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


export default function KbManagePage() {
  const toast = useToast()
  const role = localStorage.getItem('zhiwei_role') || ''
  const isAdmin = role === 'admin'
  const userId = localStorage.getItem('zhiwei_user_id') || 'default'

  const [searchKeyword, setSearchKeyword] = useState('')
  const [scope, setScope] = useState<'all' | 'public' | 'personal'>('personal')

  const [uploadOpen, setUploadOpen] = useState(false)

  const [files, setFiles] = useState<UploadedFileMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UploadedFileMeta | null>(null)
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [pendingTags, setPendingTags] = useState<Record<string, string[]>>({})
  const [savingTags, setSavingTags] = useState<Record<string, boolean>>({})

  const searchInputRef = useRef<InputRef>(null)

  useEffect(() => {
    let cancelled = false
    listPromptTemplates().then(data => { if (!cancelled) setTemplates(data) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const tagOptions = templates.map(t => ({ value: t.title, label: t.title }))

  const handleSaveTag = async (fileId: string, tags: string[]) => {
    const category = tags.join(',')
    setSavingTags(prev => ({ ...prev, [fileId]: true }))
    try {
      await updateFileCategory(fileId, category)
      setFiles(prev => prev.map(f => f.file_id === fileId ? { ...f, category } : f))
      setPendingTags(prev => { const n = { ...prev }; delete n[fileId]; return n })
      toast.success('标签添加成功')
    } catch {
      toast.error('标签保存失败')
    } finally {
      setSavingTags(prev => { const n = { ...prev }; delete n[fileId]; return n })
    }
  }

  const renderFileIcon = (name: string) => {
    const meta = getFileTypeMeta(name)
    return <div className={`file-icon file-icon-sm ${meta.colorClass}`}>{meta.icon}</div>
  }

  const loadFiles = useCallback(async (silent: boolean = false) => {
    setLoading(true)
    setError(null)
    try {
      const all = await listUploadedFiles({ user_id: userId })
      setFiles(all)
      setSelectedRowKeys([])
      if (!silent) toast.success('刷新成功')
    } catch {
      setError('加载文件列表失败')
      toast.error('加载文件列表失败')
    } finally {
      setLoading(false)
    }
  }, [userId, toast])

  const initialLoadDone = useRef(false)
  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true
      loadFiles(true)
    }
  }, [loadFiles])

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
      toast.success('删除成功')
    } catch (err) {
      toast.error('删除失败')
    } finally {
      setDeletingId(null)
      setDeleteTarget(null)
    }
  }

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) return
    setBatchDeleteOpen(true)
  }

  const executeBatchDelete = async () => {
    let successCount = 0
    for (const fileId of selectedRowKeys) {
      try {
        await deleteUploadedFile(fileId as string, userId)
        setFiles(prev => prev.filter(f => f.file_id !== fileId))
        successCount++
      } catch {
      }
    }
    setSelectedRowKeys([])
    setBatchDeleteOpen(false)
    if (successCount > 0) toast.success(`成功删除 ${successCount} 个文件`)
  }

  const tagColumn = {
    title: '标签',
    dataIndex: 'category',
    key: 'category',
    width: 220,
    render: (_cat: string | undefined, record: UploadedFileMeta) => {
      const rawCat = record.category ?? ''
      const effectiveCat = rawCat === '上传文件' ? '' : rawCat
      const effectiveTags = effectiveCat ? effectiveCat.split(',').filter(Boolean) : []
      const currentTags = pendingTags[record.file_id] ?? effectiveTags
      const isSaving = savingTags[record.file_id]
      const hasChanged = currentTags.join(',') !== effectiveTags.join(',')

      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Select
            mode="multiple"
            value={currentTags}
            placeholder="无"
            size="small"
            style={{ flex: 1, minWidth: 120 }}
            options={tagOptions}
            onChange={(val) => {
              setPendingTags(prev => ({ ...prev, [record.file_id]: val }))
            }}
          />
          {hasChanged && !isSaving && (
            <Tooltip title="确认添加标签">
              <Button
                type="text"
                size="small"
                icon={<Check size={14} style={{ color: '#10B981' }} />}
                onClick={() => handleSaveTag(record.file_id, currentTags)}
              />
            </Tooltip>
          )}
          {isSaving && <Loader2 size={14} className="progress-spinner" />}
        </div>
      )
    },
  }

  const columns: ColumnsType<UploadedFileMeta> = [
    {
      title: '文件名',
      dataIndex: 'file_name',
      key: 'file_name',
      width: 220,
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
      width: 90,
      render: (size: number) => <span style={{ color: '#6B7280', fontSize: 13 }}>{formatSize(size)}</span>,
      sorter: (a, b) => a.file_size - b.file_size,
    },
    {
      title: '状态',
      dataIndex: 'rag_status',
      key: 'rag_status',
      width: 100,
      render: (status: string, record: UploadedFileMeta) => {
        const cfg = RAG_STATUS_MAP[status] || { color: 'default', label: status }
        const tag = <Tag color={cfg.color}>{cfg.label}</Tag>
        if (status === 'failed' && record.rag_error) {
          return <Tooltip title={record.rag_error} placement="top">{tag}</Tooltip>
        }
        return tag
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
      width: 150,
      render: (time: string) => <span style={{ color: '#9CA3AF', fontSize: 12 }}>{formatTime(time)}</span>,
      sorter: (a, b) => new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime(),
      defaultSortOrder: 'descend',
    },
    // Tag column only for public KB view
    ...(scope === 'public' ? [tagColumn] : []),
    {
      title: '来源',
      dataIndex: 'user_id',
      key: 'user_id',
      width: 100,
      render: (uid: string) => (
        <Tag style={{ fontSize: 11 }} color={uid === 'default' ? 'blue' : 'default'}>
          {uid === 'default' ? '公用' : '个人'}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: UploadedFileMeta) => (
        <Button
          type="text" size="small" danger
          icon={<Trash2 size={14} />}
          loading={deletingId === record.file_id}
          onClick={() => setDeleteTarget(record)}
        />
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
            <Button size="middle" icon={<RefreshCw size={14} />} onClick={() => loadFiles()} loading={loading}>
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
        <UploadModalBody scope={scope} onDone={() => { setUploadOpen(false); loadFiles() }} />
      </Modal>

      <Modal
        title="确认删除"
        open={deleteTarget !== null}
        onOk={() => handleDelete(deleteTarget!.file_id)}
        onCancel={() => setDeleteTarget(null)}
        okText="确认删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={deletingId !== null}
        destroyOnClose
      >
        {deleteTarget && (
          <p>确定要删除「{deleteTarget.file_name}」吗？此操作不可恢复。</p>
        )}
      </Modal>

      <Modal
        title="确认批量删除"
        open={batchDeleteOpen}
        onOk={executeBatchDelete}
        onCancel={() => setBatchDeleteOpen(false)}
        okText="确认删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        destroyOnClose
      >
        <p>确定要删除选中的 {selectedRowKeys.length} 个文件吗？此操作不可恢复。</p>
      </Modal>
    </div>
  )
}
