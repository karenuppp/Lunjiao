import { Tooltip } from 'antd'
// Lucide icons — replaces all emoji structural icons in sidebar
import { Plus, X } from 'lucide-react'

interface SidebarConv {
  id: string
  title: string
  updated_at: string
  message_count: number
}

interface SidebarProps {
  collapsed: boolean
  activeConversationId: string | null
  conversations: SidebarConv[]
  onNewConversation: () => void
  onSwitchConversation: (id: string | null) => void
  onRemoveConversation: (id: string) => void
}

export default function Sidebar({
  collapsed, activeConversationId, conversations,
  onNewConversation, onSwitchConversation, onRemoveConversation,
}: SidebarProps) {
  return (
    <div className="sidebar-container">
      {}
      <button onClick={onNewConversation} className="new-chat-btn" title="新建对话">
        <Plus size={16} strokeWidth={2.5} />
        {!collapsed && <span>新对话</span>}
      </button>

      {/* Divider */}
      <div className="sidebar-divider" />

      {}
      <div className="conv-list">
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`conv-item ${conv.id === activeConversationId ? 'active' : ''}`}
            onClick={() => onSwitchConversation(conv.id)}
          >
            <Tooltip title={conv.title} mouseEnterDelay={0.8}>
              <span className="conv-title">
                {conv.title}
              </span>
            </Tooltip>
            <div className="conv-meta">
              <span>{conv.message_count}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onRemoveConversation(conv.id) }}
                className="remove-conv-btn"
                title="删除对话"
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
