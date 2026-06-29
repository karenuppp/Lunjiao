import { useState, useRef, useEffect, useCallback } from 'react'
import { Tooltip } from 'antd'
import { Plus, X, Search } from 'lucide-react'

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
  onRenameConversation: (id: string, title: string) => void
  onSearchClick: () => void
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  convId: string
}

export default function Sidebar({
  collapsed, activeConversationId, conversations,
  onNewConversation, onSwitchConversation, onRemoveConversation, onRenameConversation,
  onSearchClick,
}: SidebarProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, convId: '' })
  const [renameTarget, setRenameTarget] = useState<SidebarConv | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<SidebarConv | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Close context menu on any click outside
  useEffect(() => {
    const handler = () => setContextMenu(prev => prev.visible ? { ...prev, visible: false } : prev)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  // Focus rename input when modal opens
  useEffect(() => {
    if (renameTarget) {
      setRenameValue(renameTarget.title)
      setTimeout(() => renameInputRef.current?.focus(), 50)
    }
  }, [renameTarget])

  const handleContextMenu = useCallback((e: React.MouseEvent, conv: SidebarConv) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, convId: conv.id })
  }, [])

  const handleRenameClick = useCallback(() => {
    const conv = conversations.find(c => c.id === contextMenu.convId)
    if (conv) setRenameTarget(conv)
    setContextMenu(prev => ({ ...prev, visible: false }))
  }, [contextMenu.convId, conversations])

  const handleDeleteClick = useCallback(() => {
    const conv = conversations.find(c => c.id === contextMenu.convId)
    if (conv) setDeleteTarget(conv)
    setContextMenu(prev => ({ ...prev, visible: false }))
  }, [contextMenu.convId, conversations])

  const handleRenameConfirm = useCallback(() => {
    const trimmed = renameValue.trim()
    if (trimmed && renameTarget && trimmed !== renameTarget.title) {
      onRenameConversation(renameTarget.id, trimmed)
    }
    setRenameTarget(null)
  }, [renameValue, renameTarget, onRenameConversation])

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleRenameConfirm()
    if (e.key === 'Escape') setRenameTarget(null)
  }, [handleRenameConfirm])

  const handleDeleteConfirm = useCallback(() => {
    if (deleteTarget) {
      onRemoveConversation(deleteTarget.id)
    }
    setDeleteTarget(null)
  }, [deleteTarget, onRemoveConversation])

  return (
    <div className="sidebar-container">
      <div className="sidebar-top-actions">
        <button onClick={onNewConversation} className="new-chat-btn" title="新建对话">
          <Plus size={16} strokeWidth={2.5} />
          {!collapsed && <span>新对话</span>}
        </button>
        <button onClick={onSearchClick} className="search-chat-btn" title="搜索对话">
          <Search size={16} strokeWidth={2} />
        </button>
      </div>

      <div className="sidebar-divider" />

      <div className="conv-list">
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`conv-item ${conv.id === activeConversationId ? 'active' : ''}`}
            onClick={() => onSwitchConversation(conv.id)}
            onContextMenu={(e) => handleContextMenu(e, conv)}
          >
            <Tooltip title={conv.title} mouseEnterDelay={0.8}>
              <span className="conv-title">
                {conv.title}
              </span>
            </Tooltip>
            <div className="conv-meta">
              <span>{conv.message_count}</span>
              <button
                onClick={(e) => { e.stopPropagation(); setDeleteTarget(conv) }}
                className="remove-conv-btn"
                title="删除对话"
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button className="context-menu-item" onClick={handleRenameClick}>
            重命名
          </button>
          <button className="context-menu-item context-menu-item--danger" onClick={handleDeleteClick}>
            删除
          </button>
        </div>
      )}

      {/* Rename Modal */}
      {renameTarget && (
        <div className="context-menu-overlay" onClick={() => setRenameTarget(null)}>
          <div className="context-menu-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="context-menu-dialog-title">重命名对话</div>
            <input
              ref={renameInputRef}
              className="context-menu-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              maxLength={80}
            />
            <div className="context-menu-dialog-actions">
              <button className="context-menu-btn context-menu-btn--cancel" onClick={() => setRenameTarget(null)}>
                取消
              </button>
              <button className="context-menu-btn context-menu-btn--confirm" onClick={handleRenameConfirm}>
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="context-menu-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="context-menu-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="context-menu-dialog-title">确认删除</div>
            <p className="context-menu-dialog-body">
              确定要删除「{deleteTarget.title}」吗？此操作不可恢复。
            </p>
            <div className="context-menu-dialog-actions">
              <button className="context-menu-btn context-menu-btn--cancel" onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              <button className="context-menu-btn context-menu-btn--danger" onClick={handleDeleteConfirm}>
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
