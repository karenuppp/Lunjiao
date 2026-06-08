import { useState, useEffect, useCallback } from 'react'
import { Button, Input, Table, Popconfirm, Spin } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PlusOutlined, ClearOutlined, EditOutlined, DeleteOutlined, CheckOutlined } from '@ant-design/icons'
import {
  listSkills,
  createSkill,
  updateSkill,
  deleteSkill,
  generateSkill,
  type SkillRecord,
} from '../api/chat'
import { useToast } from './Toast'

const PLACEHOLDER = `请描述你的技能需求，例如：

- 技能用途：这个技能用来做什么？
- 触发场景：在什么情况下应该调用这个技能？
- 工作步骤：需要执行哪些步骤？
- 输出要求：期望输出什么格式的内容？
- 注意事项：有什么需要特别注意的地方？

系统会根据你的需求自动生成一个规范的技能文件。`

export default function SkillManagePage() {
  const toast = useToast()
  const [skills, setSkills] = useState<SkillRecord[]>([])
  const [loading, setLoading] = useState(false)

  // Form state
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)

  // Generate state
  const [generating, setGenerating] = useState(false)
  const [generatedContent, setGeneratedContent] = useState('')

  const fetchSkills = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listSkills()
      setSkills(data)
    } catch (err: any) {
      toast.error('加载技能列表失败: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSkills()
  }, [fetchSkills])

  const isEditing = editingId !== null
  const hasGenerated = !!generatedContent

  function resetForm() {
    setTitle('')
    setContent('')
    setGeneratedContent('')
    setEditingId(null)
  }

  async function handleGenerate() {
    if (!title.trim()) {
      toast.error('请输入技能标题')
      return
    }
    if (!content.trim()) {
      toast.error('请输入技能需求')
      return
    }
    setGenerating(true)
    try {
      const result = await generateSkill(title.trim(), content.trim())
      setGeneratedContent(result.content)
      setContent(result.content)
      toast.success('技能生成成功，请确认后点击确认按钮保存')
    } catch (err: any) {
      toast.error('生成失败: ' + err.message)
    } finally {
      setGenerating(false)
    }
  }

  async function handleConfirm() {
    if (!title.trim()) {
      toast.error('请输入标题')
      return
    }
    if (!content.trim()) {
      toast.error('技能内容不能为空')
      return
    }
    try {
      const userId = localStorage.getItem('zhiwei_user_id') || 'admin'
      await createSkill(title.trim(), content.trim(), userId)
      toast.success('技能创建成功')
      resetForm()
      await fetchSkills()
    } catch (err: any) {
      toast.error('创建失败: ' + err.message)
    }
  }

  async function handleSave() {
    if (editingId === null) return
    if (!title.trim()) {
      toast.error('请输入标题')
      return
    }
    if (!content.trim()) {
      toast.error('技能内容不能为空')
      return
    }
    try {
      await updateSkill(editingId, { title: title.trim(), content: content.trim() })
      toast.success('修改成功')
      resetForm()
      await fetchSkills()
    } catch (err: any) {
      toast.error('保存失败: ' + err.message)
    }
  }

  function handleEdit(skill: SkillRecord) {
    setTitle(skill.title)
    setContent(skill.content)
    setGeneratedContent('')
    setEditingId(skill.id)
  }

  async function handleDelete(id: number) {
    try {
      await deleteSkill(id)
      toast.success('删除成功')
      if (editingId === id) resetForm()
      await fetchSkills()
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

  const columns: ColumnsType<SkillRecord> = [
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
      title: '技能描述',
      dataIndex: 'description',
      key: 'description',
      render: (text: string) => {
        const display = text || '暂无描述'
        const preview = display.length > 60 ? display.slice(0, 60) + '…' : display
        return (
          <span style={{ color: '#6b7280', fontSize: 13 }}>{preview}</span>
        )
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 150,
      render: (val: string | null) => (
        <span style={{ fontSize: 13, color: '#6b7280' }}>{formatTime(val)}</span>
      ),
    },
    {
      title: '创建用户',
      dataIndex: 'created_by',
      key: 'created_by',
      width: 120,
      render: (val: string) => (
        <span style={{ fontSize: 13, color: '#6b7280' }}>{val}</span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_: unknown, record: SkillRecord) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            修改
          </Button>
          <Popconfirm
            title="确认删除"
            description={`确定要删除技能「${record.title}」吗？`}
            onConfirm={() => handleDelete(record.id)}
            okText="确认删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            getPopupContainer={() => document.body}
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
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <div className="page-card">
        <h2 className="page-card-heading">
          {isEditing ? '修改技能' : '新建技能'}
        </h2>

        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 500, color: '#374151' }}>
            标题
          </div>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="请输入技能标题"
            style={{ maxWidth: 480 }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 500, color: '#374151' }}>
            需求描述
          </div>
          <Input.TextArea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={PLACEHOLDER}
            rows={14}
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
            disabled={generating}
          >
            清空
          </Button>
          {generating ? (
            <Button type="primary" loading disabled>
              <Spin size="small" style={{ marginRight: 6 }} />
              技能生成中…
            </Button>
          ) : isEditing ? (
            <Button
              type="primary"
              icon={<EditOutlined />}
              onClick={handleSave}
            >
              保存
            </Button>
          ) : hasGenerated ? (
            <Button
              type="primary"
              icon={<CheckOutlined />}
              onClick={handleConfirm}
            >
              确认
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleGenerate}
            >
              创建
            </Button>
          )}
        </div>
      </div>

      <div className="page-card">
        <h2 className="page-card-heading">技能列表</h2>
        <Table
          columns={columns}
          dataSource={skills}
          rowKey="id"
          loading={loading}
          pagination={false}
          locale={{ emptyText: '暂无技能' }}
          size="middle"
        />
      </div>
    </div>
  )
}
