import { useState, useEffect, useCallback } from 'react'
import { Button, Input, Table, Modal } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PlusOutlined, SaveOutlined, ClearOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import {
  listPromptTemplates,
  createPromptTemplate,
  updatePromptTemplate,
  deletePromptTemplate,
  type PromptTemplate,
} from '../api/chat'
import { useToast } from './Toast'

export default function PromptManagePage() {
  const toast = useToast()
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PromptTemplate | null>(null)

  // Form state
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)

  const fetchTemplates = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listPromptTemplates()
      setTemplates(data)
    } catch (err: any) {
      toast.error('加载提示词列表失败: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  const isEditing = editingId !== null

  function resetForm() {
    setTitle('')
    setContent('')
    setEditingId(null)
  }

  async function handleAdd() {
    if (!title.trim()) {
      toast.error('请输入标题')
      return
    }
    if (!content.trim()) {
      toast.error('请输入提示词内容')
      return
    }
    try {
      await createPromptTemplate(title.trim(), content.trim())
      toast.success('新增成功')
      resetForm()
      await fetchTemplates()
    } catch (err: any) {
      toast.error('新增失败: ' + err.message)
    }
  }

  async function handleSave() {
    if (editingId === null) return
    if (!title.trim()) {
      toast.error('请输入标题')
      return
    }
    if (!content.trim()) {
      toast.error('请输入提示词内容')
      return
    }
    try {
      await updatePromptTemplate(editingId, { title: title.trim(), content: content.trim() })
      toast.success('修改成功')
      resetForm()
      await fetchTemplates()
    } catch (err: any) {
      toast.error('保存失败: ' + err.message)
    }
  }

  function handleEdit(template: PromptTemplate) {
    setTitle(template.title)
    setContent(template.content)
    setEditingId(template.id)
  }

  async function handleDelete(id: number) {
    try {
      await deletePromptTemplate(id)
      toast.success('删除成功')
      if (editingId === id) resetForm()
      setDeleteTarget(null)
      await fetchTemplates()
    } catch (err: any) {
      toast.error('删除失败: ' + err.message)
    }
  }

  const columns: ColumnsType<PromptTemplate> = [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      width: 180,
      render: (text: string) => (
        <span style={{ fontWeight: 500 }}>{text}</span>
      ),
    },
    {
      title: '提示词',
      dataIndex: 'content',
      key: 'content',
      render: (text: string) => {
        const preview = text.length > 80 ? text.slice(0, 80) + '…' : text
        return (
          <span style={{ color: '#6b7280', fontSize: 13 }}>{preview}</span>
        )
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_: unknown, record: PromptTemplate) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            修改
          </Button>
          {record.prompt_key === 'default' ? (
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled
            >
              删除
            </Button>
          ) : (
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => setDeleteTarget(record)}
            >
              删除
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <div className="page-card">
        <h2 className="page-card-heading">
          {isEditing ? '修改提示词模板' : '新增提示词模板'}
        </h2>

        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 500, color: '#374151' }}>
            标题
          </div>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="请输入提示词标题"
            style={{ maxWidth: 480 }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <div className="system-prompt-label" style={{ marginBottom: 8, fontSize: 13, fontWeight: 500, color: '#374151' }}>
            系统提示词
          </div>
          <Input.TextArea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="请输入系统提示词内容..."
            rows={16}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <Button
            icon={<ClearOutlined />}
            onClick={resetForm}
          >
            清除
          </Button>
          {isEditing ? (
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
            >
              保存
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAdd}
            >
              新增
            </Button>
          )}
        </div>
      </div>

      <div className="page-card">
        <h2 className="page-card-heading">提示词模板列表</h2>
        <Table
          columns={columns}
          dataSource={templates}
          rowKey="id"
          loading={loading}
          pagination={false}
          locale={{ emptyText: '暂无提示词模板' }}
          size="middle"
        />
      </div>

      <Modal
        title="确认删除"
        open={deleteTarget !== null}
        onOk={() => handleDelete(deleteTarget!.id)}
        onCancel={() => setDeleteTarget(null)}
        okText="确认删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        destroyOnClose
      >
        {deleteTarget && (
          <p>确定要删除提示词「{deleteTarget.title}」吗？</p>
        )}
      </Modal>
    </div>
  )
}
