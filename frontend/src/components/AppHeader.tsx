import { useNavigate, useLocation } from 'react-router-dom'
import { Button } from 'antd'
import {
  MenuUnfoldOutlined,
  MenuFoldOutlined,
  LogoutOutlined,
} from '@ant-design/icons'
import { useChat } from '../store/chatStore'

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

  const handleLogout = () => {
    chat.logout()
    navigate('/', { replace: true })
  }

  const isAdmin = chat.role === 'admin'

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
            AI 智能问答
          </button>

          <button
            className={`header-tab ${location.pathname.startsWith('/knowledge-base') ? 'header-tab--active' : ''}`}
            onClick={() => navigate('/knowledge-base')}
          >
            知识库管理
          </button>

          {isAdmin && (
            <button
              className={`header-tab ${location.pathname.startsWith('/admin') ? 'header-tab--active' : ''}`}
              onClick={() => navigate('/admin/users')}
            >
              用户管理
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

      <div className="logout-btn-box" onClick={handleLogout}>
        <LogoutOutlined style={{ color: '#EF4444' }} />
        <span style={{ color: '#EF4444', fontSize: 13 }}>退出</span>
      </div>
    </div>
  )
}
