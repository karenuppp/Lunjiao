import { Button } from 'antd'
import { MenuUnfoldOutlined, MenuFoldOutlined } from '@ant-design/icons'

interface AppHeaderProps {
  collapsed: boolean
  onToggleSidebar: () => void
  sessionTitle: string
  currentView?: 'chat' | 'kb'
}

export default function AppHeader({
  collapsed, onToggleSidebar, sessionTitle, currentView = 'chat',
}: AppHeaderProps) {
  return (
    <div className="top-bar">
      {/* Toggle sidebar */}
      <Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        onClick={onToggleSidebar} size="small" style={{ color: '#6b7280', fontSize: 16, padding: '4px 6px' }} />

      {/* Title */}
      <span style={{ fontSize: 15, fontWeight: 600, color: '#1a1b2e', letterSpacing: '-0.3px' }}>
        {sessionTitle}
      </span>
    </div>
  )
}
