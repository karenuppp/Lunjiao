import { useState, useEffect, useCallback } from 'react'
import { Table, Button, Modal, Select, Input, Tag, Popconfirm, Space } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { EditOutlined, DeleteOutlined } from '@ant-design/icons'
import {
  listExperiences,
  updateExperience,
  deleteExperience,
  getExperienceTags,
  type ExperienceRecord,
} from '../api/chat'
import { useToast } from './Toast'

export default function ExpManagePage() {
  const toast = useToast()

  const [experiences, setExperiences] = useState<ExperienceRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const pageSize = 20

  const [availableTags, setAvailableTags] = useState<string[]>([])

  // Edit modal
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingExp, setEditingExp] = useState<ExperienceRecord | null>(null)
  const [editTags, setEditTags] = useState<string[]>([])
  const [editContent, setEditContent] = useState('')
  const [editSubmitting, setEditSubmitting] = useState(false)

  const fetchExperiences = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listExperiences({ page, page_size: pageSize })
      setExperiences(data.items)
      setTotal(data.total)
    } catch (err: any) {
      toast.error('加载经验列表失败: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [page])

  const fetchTags = useCallback(async () => {
    try {
      const data = await getExperienceTags()
      setAvailableTags(data.tags || [])
    } catch {
    }
  }, [])

  useEffect(() => {
    fetchExperiences()
    fetchTags()
  }, [fetchExperiences, fetchTags])

  function openEditModal(exp: ExperienceRecord) {
    setEditingExp(exp)
    setEditTags(exp.tags || [])
    setEditContent(exp.content)
    setEditModalOpen(true)
  }

  async function handleEditSave() {
    if (!editingExp) return
    if (!editContent.trim()) {
      toast.error('经验详情不能为空')
      return
    }
    setEditSubmitting(true)
    try {
      await updateExperience(editingExp.id, {
        content: editContent.trim(),
        tags: editTags,
      })
      toast.success('修改成功')
      setEditModalOpen(false)
      fetchExperiences()
    } catch (err: any) {
      toast.error('修改失败: ' + err.message)
    } finally {
      setEditSubmitting(false)
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteExperience(id)
      toast.success('删除成功')
      fetchExperiences()
    } catch (err: any) {
      toast.error('删除失败: ' + err.message)
    }
  }

  function formatTime(isoStr: string | null): string {
    if (!isoStr) return '-'
    const d = new Date(isoStr)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const columns: ColumnsType<ExperienceRecord> = [
    {
      title: '标签',
      dataIndex: 'tags',
      key: 'tags',
      width: 160,
      render: (tags: string[]) => (
        <Space size={4} wrap>
          {(tags || []).slice(0, 2).map((t) => (
            <Tag key={t} color="blue" style={{ margin: 0 }}>{t}</Tag>
          ))}
          {(tags || []).length > 2 && (
            <Tag style={{ margin: 0 }}>+{tags.length - 2}</Tag>
          )}
        </Space>
      ),
    },
    {
      title: <span className="exp-detail-header">经验详情</span>,
      dataIndex: 'content',
      key: 'content',
      render: (text: string) => {
        const preview = text.length > 80 ? text.slice(0, 80) + '…' : text
        return (
          <span style={{ color: '#4b5563', fontSize: 13, lineHeight: 1.5 }}>{preview}</span>
        )
      },
    },
    {
      title: '提取时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 150,
      render: (val: string | null) => (
        <span style={{ fontSize: 13, color: '#6b7280' }}>{formatTime(val)}</span>
      ),
    },
    {
      title: '提取来源',
      dataIndex: 'user_id',
      key: 'user_id',
      width: 120,
      render: (val: string) => (
        <span style={{ fontSize: 13, color: '#6b7280' }}>{val}</span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 130,
      render: (_: unknown, record: ExperienceRecord) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditModal(record)}
          >
            修改
          </Button>
          <Popconfirm
            title="确认删除"
            description="确定要删除这条经验吗？"
            onConfirm={() => handleDelete(record.id)}
            okText="确认删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
            >
              删除
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ]

  return (
    <div style={{ height: '100%', padding: '32px', overflow: 'auto' }}>
      <div className="page-card">
        <h3 className="page-card-heading">
          经验列表（{total}）
        </h3>
        <Table
          columns={columns}
          dataSource={experiences}
          rowKey="id"
          loading={loading}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: (p) => setPage(p),
            showSizeChanger: false,
            showTotal: (t) => `共 ${t} 条`,
          }}
          size="middle"
          locale={{ emptyText: '暂无经验数据' }}
        />
      </div>

      <Modal
        title="修改经验"
        open={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        onOk={handleEditSave}
        confirmLoading={editSubmitting}
        okText="确认修改"
        cancelText="取消"
        width={560}
      >
        <div style={{ margin: '12px 0' }}>
          <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 500, color: '#374151' }}>
            标签
          </div>
          <Select
            mode="multiple"
            value={editTags}
            onChange={setEditTags}
            style={{ width: '100%', marginBottom: 16 }}
            placeholder="选择标签（提示词模板标题）"
            options={availableTags.map((t) => ({ value: t, label: t }))}
          />

          <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 500, color: '#374151' }}>
            经验详情
          </div>
          <Input.TextArea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={6}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.6 }}
          />
        </div>
      </Modal>
    </div>
  )
}
