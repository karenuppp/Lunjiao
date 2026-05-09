import { useState, useCallback } from 'react'
import { Layout, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { ChatProvider, useChat } from './store/chatStore'
import Sidebar from './components/Sidebar'
import AppHeader from './components/AppHeader'
import ChatPanel from './components/ChatPanel'
import KbManagePage from './components/KbManagePage'
import KbListModal from './components/KbListModal'
import LoginPage from './components/LoginPage'

const { Sider, Content } = Layout

function AppInner() {
  const chat = useChat()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sessionTitle, setSessionTitle] = useState('新对话')
  const [kbListOpen, setKbListOpen] = useState(false)

  const appView = chat.appView ?? 'chat'

  // Update header title when view or conversation changes
  if (appView === 'kb') {
    setSessionTitle(prev => prev !== '知识库管理' ? '知识库管理' : prev)
  } else if (!sessionTitle || sessionTitle === '知识库管理') {
    const activeConv = chat.conversations.find((c: any) => c.id === chat.activeConversationId)
    setSessionTitle(activeConv ? (activeConv.title || '智能问答') : '新对话')
  }

  const conversations = chat.conversations ?? []
  const convList = conversations.map((c: any) => ({
    id: c.id, title: c.title || 'Untitled', updated_at: '', message_count: (c.messages ?? []).length,
  }))

  return (
    <Layout style={{ height: '100vh', width: '100vw' }}>
      <Sider
        width={260} collapsedWidth={0} collapsed={sidebarCollapsed}
        className="app-sider" trigger={null}
        style={{ height: '100vh', overflow: 'hidden' }}
      >
        <Sidebar
          collapsed={sidebarCollapsed} activeConversationId={chat.activeConversationId}
          conversations={convList}
          onNewConversation={() => { chat.newConversation(); setSessionTitle('新对话') }}
          onSwitchConversation={(id) => {
            chat.switchConversation(id)
            const conv = id ? (chat.conversations.find((c: any) => c.id === id)) : null
            setSessionTitle(conv ? (conv.title || '智能问答') : '新对话')
          }}
          onRemoveConversation={chat.removeConversation}
          onViewChange={(view) => {
            chat.setView(view)
            if (view === 'kb') setSessionTitle('知识库管理')
            else {
              const activeConv = chat.conversations.find((c: any) => c.id === chat.activeConversationId)
              setSessionTitle(activeConv ? (activeConv.title || '智能问答') : '新对话')
            }
          }}
          currentView={appView}
        />
      </Sider>

      <Layout style={{ height: '100vh' }}>
        <AppHeader
          collapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
          sessionTitle={sessionTitle}
          currentView={appView}
        />
        <Content style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {appView === 'kb' ? (
            <KbManagePage />
          ) : (
            <ChatPanel
              messages={chat.messages ?? []}
              isLoading={chat.isLoading ?? false}
              currentTool={chat.currentTool ?? null}
              uploadedFiles={chat.uploadedFiles ?? []}
              onSendChat={chat.sendChat}
              onUploadFile={chat.uploadFile}
              onRemoveUploadedFile={chat.removeUploadedFile}
              onOpenKbList={() => setKbListOpen(true)}
            />
          )}
        </Content>
      </Layout>

      <KbListModal open={kbListOpen} onClose={() => setKbListOpen(false)} />
    </Layout>
  )
}

export default function App() {
  // Check for existing session on mount
  const [loggedIn, setLoggedIn] = useState(() => {
    const uid = localStorage.getItem('lunjiao_user_id')
    return !!uid && uid !== 'default'
  })

  const handleLogin = useCallback((_userId: string) => {
    setLoggedIn(true)
  }, [])

  if (!loggedIn) {
    return (
      <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#6366f1', borderRadius: 6 } }}>
        <LoginPage onLogin={handleLogin} />
      </ConfigProvider>
    )
  }

  return (
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#6366f1', borderRadius: 6 } }}>
      <ChatProvider><AppInner /></ChatProvider>
    </ConfigProvider>
  )
}
