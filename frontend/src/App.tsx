import { useState, useCallback } from 'react'
import { Layout, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { ChatProvider, useChat } from './store/chatStore'
import Sidebar from './components/Sidebar'
import AppHeader from './components/AppHeader'
import ChatPanel from './components/ChatPanel'
import KbListModal from './components/KbListModal'
import LoginPage from './components/LoginPage'

const { Sider, Content } = Layout

function AppInner() {
  const chat = useChat()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sessionTitle, setSessionTitle] = useState('新对话')
  const [kbListOpen, setKbListOpen] = useState(false)

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
          onSwitchConversation={(id) => { chat.switchConversation(id); setSessionTitle(id ? '智能问答' : '新对话') }}
          onRemoveConversation={chat.removeConversation}
        />
      </Sider>

      <Layout style={{ height: '100vh' }}>
        <AppHeader
          collapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
          sessionTitle={sessionTitle}
        />
        <Content style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
