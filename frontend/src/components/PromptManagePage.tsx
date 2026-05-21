import { useState, useEffect } from 'react'
import { Button, message, Spin } from 'antd'
import { CheckOutlined, RollbackOutlined } from '@ant-design/icons'
import { getSystemPrompt, updateSystemPrompt } from '../api/chat'

export default function PromptManagePage() {
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadPrompt()
  }, [])

  async function loadPrompt() {
    setLoading(true)
    try {
      const data = await getSystemPrompt()
      setContent(data.content)
      setSavedContent(data.content)
    } catch {
      message.error('加载提示词失败，请检查后端服务')
    } finally {
      setLoading(false)
    }
  }

  async function handleApply() {
    if (!content.trim()) {
      message.warning('提示词内容不能为空')
      return
    }
    setSaving(true)
    try {
      await updateSystemPrompt(content)
      setSavedContent(content)
      message.success('提示词已应用')
    } catch (err: any) {
      message.error(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  function handleRestore() {
    setContent(savedContent)
    message.info('已还原到当前后端保存的提示词')
  }

  if (loading) {
    return (
      <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }

  const hasChanges = content !== savedContent

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <div className="page-card" style={{ padding: 32 }}>
        <h2 className="page-card-heading">提示词管理</h2>

        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>
          编辑 AI 智能问答的系统提示词（System Prompt）。修改后点击「应用」保存到后端，
          或点击「还原」恢复到后端当前版本。
        </p>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          style={{
            width: '100%',
            minHeight: 360,
            padding: 16,
            fontSize: 14,
            fontFamily: 'var(--font-mono)',
            lineHeight: 1.7,
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            resize: 'vertical',
            outline: 'none',
            background: '#FAFBFC',
            color: 'var(--text-primary)',
            transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-primary)'
            e.currentTarget.style.boxShadow = '0 0 0 3px rgba(79, 70, 229, 0.1)'
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-default)'
            e.currentTarget.style.boxShadow = 'none'
          }}
          placeholder="请输入系统提示词..."
        />

        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 12,
          marginTop: 20,
        }}>
          <Button
            icon={<RollbackOutlined />}
            onClick={handleRestore}
            disabled={!hasChanges}
          >
            还原
          </Button>
          <Button
            type="primary"
            icon={<CheckOutlined />}
            onClick={handleApply}
            loading={saving}
            disabled={!hasChanges}
          >
            应用
          </Button>
        </div>
      </div>
    </div>
  )
}
