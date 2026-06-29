import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Modal, Input, Tag, Popover } from 'antd'
import {
  MenuUnfoldOutlined,
  MenuFoldOutlined,
  LogoutOutlined,
  QuestionCircleOutlined,
  MessageOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import { useChat } from '../store/chatStore'
import { useTour } from '../store/tourStore'
import { submitOpinion, checkSandboxStatus, listSkills, type SkillRecord } from '../api/chat'
import { useToast } from './Toast'

interface AppHeaderProps {
  collapsed: boolean
  onToggleSidebar: () => void
  sessionTitle: string
}

export default function AppHeader({
  collapsed,
  onToggleSidebar,
  sessionTitle,
}: AppHeaderProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const chat = useChat()
  const tour = useTour()
  const toast = useToast()

  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackContent, setFeedbackContent] = useState('')
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [sandboxReady, setSandboxReady] = useState(false)
  const [skills, setSkills] = useState<SkillRecord[]>([])
  const [skillsError, setSkillsError] = useState(false)

  useEffect(() => {
    listSkills()
      .then(setSkills)
      .catch(() => setSkillsError(true))
  }, [])

  const pollSandbox = useCallback(async () => {
    try {
      const { available } = await checkSandboxStatus()
      setSandboxReady(available)
    } catch {
      setSandboxReady(false)
    }
  }, [])

  useEffect(() => {
    pollSandbox()
    const timer = setInterval(pollSandbox, 30000)
    return () => clearInterval(timer)
  }, [pollSandbox])

  const handleLogout = () => {
    chat.logout()
    navigate('/', { replace: true })
  }

  const isAdmin = chat.role === 'admin'

  const handleStartTour = () => {
    tour.startTour(isAdmin)
  }

  const handleSubmitFeedback = async () => {
    if (!feedbackContent.trim()) {
      toast.error('请输入反馈内容')
      return
    }
    setFeedbackSubmitting(true)
    try {
      await submitOpinion(feedbackContent.trim())
      toast.success('感谢您的反馈！')
      setFeedbackOpen(false)
      setFeedbackContent('')
    } catch {
      toast.error('提交失败，请稍后再试')
    } finally {
      setFeedbackSubmitting(false)
    }
  }

  const skillPopoverContent = (
    <div className="skill-popover-content">
      {skillsError ? (
        <p className="skill-empty">加载失败</p>
      ) : skills.length === 0 ? (
        <p className="skill-empty">暂无已装备技能</p>
      ) : (
        skills.map(s => (
          <div key={s.id} className="skill-item">
            <div className="skill-title">🔑 {s.title}</div>
            <div className="skill-desc">{s.description}</div>
          </div>
        ))
      )}
    </div>
  )

  return (
    <div className="top-bar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button
          type="text"
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={onToggleSidebar}
          size="small"
          style={{ color: '#6b7280', fontSize: 16, padding: '4px 6px' }}
        />

        <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            className={`header-tab ${location.pathname === '/chat' || location.pathname === '/' ? 'header-tab--active' : ''}`}
            onClick={() => navigate('/chat')}
          >
            智能问答
          </button>

          <button
            className={`header-tab ${location.pathname.startsWith('/knowledge-base') ? 'header-tab--active' : ''}`}
            onClick={() => navigate('/knowledge-base')}
          >
            知识库管理
          </button>

          {isAdmin && (
            <button
              className={`header-tab ${location.pathname.startsWith('/admin/database') ? 'header-tab--active' : ''}`}
              onClick={() => navigate('/admin/database')}
            >
              数据库管理
            </button>
          )}

          {isAdmin && (
            <button
              className={`header-tab ${location.pathname.startsWith('/admin/users') ? 'header-tab--active' : ''}`}
              onClick={() => navigate('/admin/users')}
            >
              用户管理
            </button>
          )}

          {isAdmin && (
            <button
              className={`header-tab ${location.pathname.startsWith('/admin/prompt') ? 'header-tab--active' : ''}`}
              onClick={() => navigate('/admin/prompt')}
            >
              提示词管理
            </button>
          )}

          {isAdmin && (
            <button
              className={`header-tab ${location.pathname.startsWith('/admin/experience') ? 'header-tab--active' : ''}`}
              onClick={() => navigate('/admin/experience')}
            >
              经验管理
            </button>
          )}

          {isAdmin && (
            <button
              className={`header-tab ${location.pathname.startsWith('/admin/skills') ? 'header-tab--active' : ''}`}
              onClick={() => navigate('/admin/skills')}
            >
              技能工厂
            </button>
          )}
        </nav>
      </div>

      <span
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: '#1a1b2e',
          letterSpacing: '-0.3px',
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      >
        {sessionTitle}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Popover content={skillPopoverContent} title="已装备技能" trigger="hover">
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 0', cursor: 'pointer' }}>
            <Tag
              color={sandboxReady ? 'green' : 'red'}
              style={{ margin: 0 }}
            >
              {sandboxReady ? '技能已装备' : '技能未预备'}
            </Tag>
          </span>
        </Popover>
        <div
          className="help-btn-box"
          onClick={() => setChangelogOpen(true)}
          title="更新日志"
        >
          <ClockCircleOutlined style={{ color: '#4F46E5' }} />
          <span style={{ color: '#4F46E5', fontSize: 13 }}>更新日志</span>
        </div>
        <div
          className="help-btn-box"
          onClick={handleStartTour}
          title="使用说明"
        >
          <QuestionCircleOutlined style={{ color: '#4F46E5' }} />
          <span style={{ color: '#4F46E5', fontSize: 13 }}>使用说明</span>
        </div>
        <div
          className="help-btn-box"
          onClick={() => setFeedbackOpen(true)}
          title="反馈"
        >
          <MessageOutlined style={{ color: '#4F46E5' }} />
          <span style={{ color: '#4F46E5', fontSize: 13 }}>反馈</span>
        </div>
        <div className="logout-btn-box" onClick={handleLogout}>
          <LogoutOutlined style={{ color: '#EF4444' }} />
          <span style={{ color: '#EF4444', fontSize: 13 }}>退出</span>
        </div>
      </div>

      <Modal
        title="反馈内容"
        open={feedbackOpen}
        onCancel={() => { setFeedbackOpen(false); setFeedbackContent('') }}
        footer={null}
        width={480}
        destroyOnClose
      >
        <div style={{ marginTop: 12 }}>
          <Input.TextArea
            value={feedbackContent}
            onChange={(e) => setFeedbackContent(e.target.value)}
            placeholder="请输入您的反馈意见…"
            rows={6}
            style={{ fontSize: 14, lineHeight: 1.6 }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <Button
              type="primary"
              onClick={handleSubmitFeedback}
              loading={feedbackSubmitting}
            >
              提交
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        title="更新日志"
        open={changelogOpen}
        onCancel={() => setChangelogOpen(false)}
        footer={null}
        width={640}
        destroyOnClose
      >
        <div style={{ marginTop: 8, maxHeight: 460, overflowY: 'auto', lineHeight: 1.8, fontSize: 14 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, color: '#4F46E5', marginBottom: 4, fontSize: 15 }}>v0.8</div>
            <div style={{ fontWeight: 600, color: '#1a1b2e', marginBottom: 6 }}>2026-06-15</div>
            <ul style={{ margin: 0, paddingLeft: 20, color: '#4b5563' }}>
              <li>新增技能工厂代码执行能力，skill 中的 Python 脚本可在安全沙箱中自动运行</li>
              <li>新增对话页顶部技能状态提示，一目了然当前是否支持代码执行</li>
              <li>新增回答内容导出功能，长回答可下载为 Word 文档，大表格可下载为 Excel 表格</li>
              <li>新增删除对话时自动清理对话中的上传文件</li>
              <li>公用知识库标签支持多选，可为一个文件同时打上多个标签</li>
              <li>修复点赞优质回答后经验未保存的问题</li>
              <li>修复各管理页面删除按钮偶尔无反应的问题</li>
              <li>修复浏览器刷新后跳回登录页的问题</li>
              <li>修复上传文件弹窗关闭再打开时显示上次文件的问题</li>
              <li>修复文件索引失败时无法查看具体原因的问题</li>
              <li>优化知识库检索顺序与标签过滤逻辑，让标签筛选更精准</li>
              <li>优化上传文件按钮与当前知识库范围联动</li>
              <li>简化经验管理页面筛选项</li>
            </ul>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, color: '#4F46E5', marginBottom: 4, fontSize: 15 }}>v0.2</div>
            <div style={{ fontWeight: 600, color: '#1a1b2e', marginBottom: 6 }}>2026-06-05</div>
            <ul style={{ margin: 0, paddingLeft: 20, color: '#4b5563' }}>
              <li>新增对话记录搜索功能，可按关键词快速定位过往问答</li>
              <li>新增对话内容标签区分，便于提取经验后归类</li>
              <li>修复点赞优质回答不能自动提取为经验的问题</li>
              <li>修复对话框中上传文件出错的问题</li>
              <li>修复连续长时间对话页面卡顿的问题</li>
              <li>优化智能问答底层逻辑</li>
              <li>优化多个对话窗口同时回复</li>
              <li>优化经验管理页面布局</li>
            </ul>
          </div>
        </div>
      </Modal>
    </div>
  )
}
