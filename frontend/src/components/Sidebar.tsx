import { Tooltip } from 'antd'

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
  onOpenKbManage: () => void
}

export default function Sidebar({
  collapsed, activeConversationId, conversations,
  onNewConversation, onSwitchConversation, onRemoveConversation,
  onOpenKbManage,
}: SidebarProps) {
  return (
    <div style={{ padding: '16px 8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* New conversation button */}
      <button
        onClick={onNewConversation}
        style={{
          width: '100%',
          padding: '10px 16px',
          marginBottom: 12,
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.1)',
          background: 'rgba(255,255,255,0.06)',
          color: '#e5e7eb',
          cursor: 'pointer',
          fontSize: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> 新对话
      </button>

      {/* Divider */}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '0 8px 12px' }} />

      {/* Conversation list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {conversations.map((conv) => (
          <div
            key={conv.id}
            onClick={() => onSwitchConversation(conv.id)}
            style={{
              padding: '10px 12px',
              marginBottom: 2,
              borderRadius: 8,
              cursor: 'pointer',
              background: conv.id === activeConversationId ? 'rgba(255,255,255,0.08)' : 'transparent',
              color: conv.id === activeConversationId ? '#fff' : '#9ca3af',
              transition: 'all 0.15s',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
            onMouseEnter={(e) => {
              if (conv.id !== activeConversationId) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
            }}
            onMouseLeave={(e) => {
              if (conv.id !== activeConversationId) e.currentTarget.style.background = 'transparent'
            }}
          >
            <Tooltip title={conv.title} mouseEnterDelay={0.8}>
              <span style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                fontSize: 14,
              }}>
                {conv.title}
              </span>
            </Tooltip>
            <span style={{ fontSize: 11, opacity: 0.5, marginLeft: 8, whiteSpace: 'nowrap' }}>
              {conv.message_count} 条
              <button
                onClick={(e) => { e.stopPropagation(); onRemoveConversation(conv.id) }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#6b7280',
                  cursor: 'pointer',
                  marginLeft: 6,
                  fontSize: 12,
                  padding: '2px 4px',
                  borderRadius: 4,
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
                onMouseLeave={(e) => e.currentTarget.style.color = '#6b7280'}
                title="删除对话"
              >
                ✕
              </button>
            </span>
          </div>
        ))}
      </div>

      {/* Bottom: Knowledge base entry */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8 }}>
        <button
          onClick={onOpenKbManage}
          style={{
            width: '100%',
            padding: '10px 16px',
            borderRadius: 8,
            border: 'none',
            background: 'transparent',
            color: '#9ca3af',
            cursor: 'pointer',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>📂</span> 知识库
        </button>
      </div>
    </div>
  )
}
