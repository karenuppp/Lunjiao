import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { Layout, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { ChatProvider, useChat } from './store/chatStore'
import type { ReactNode } from 'react'
import type { UserInfo } from './types/chat'

import LoginPage from './components/LoginPage'
import Sidebar from './components/Sidebar'
import AppHeader from './components/AppHeader'
import ChatPanel from './components/ChatPanel'
import KbManagePage from './components/KbManagePage'
import UserManagePage from './components/UserManagePage'

const { Sider, Content } = Layout

// ============================================================
// LoginPage Wrapper — connects to chatStore login
// ============================================================

function LoginPageWrapper() {
  const chat = useChat()
  const navigate = useNavigate()

  const handleLogin = async (account: string, password: string): Promise<UserInfo> => {
    const user = await chat.login(account, password)
    navigate('/chat', { replace: true })
    return user
  }

  return <LoginPage onLogin={handleLogin} />
}

// ============================================================
// ProtectedRoute — redirects to /login if not authenticated
// ============================================================

function ProtectedRoute({ children, requireAdmin }: { children: ReactNode; requireAdmin?: boolean }) {
  const chat = useChat()

  if (!chat.loggedIn) {
    return <Navigate to="/" replace />
  }

  if (requireAdmin && chat.role !== 'admin') {
    return <Navigate to="/chat" replace />
  }

  return <>{children}</>
}

// ============================================================
// ChatLayout — sidebar + header + chat panel / kb page (existing UI)
// ============================================================

function ChatLayout() {
  const chat = useChat()
  const location = useLocation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const isKb = location.pathname.startsWith('/knowledge-base')

  const conversations = chat.conversations ?? []
  const convList = conversations.map((c: any) => ({
    id: c.id,
    title: c.title || 'Untitled',
    updated_at: '',
    message_count: (c.messages ?? []).length,
  }))

  return (
    <Layout style={{ height: '100vh', width: '100vw' }}>
      {!isKb && (
        <Sider
          width={260}
          collapsedWidth={0}
          collapsed={sidebarCollapsed}
          className="app-sider"
          trigger={null}
          style={{ height: '100vh', overflow: 'hidden' }}
        >
          <Sidebar
            collapsed={sidebarCollapsed}
            activeConversationId={chat.activeConversationId}
            conversations={convList}
            onNewConversation={chat.newConversation}
            onSwitchConversation={chat.switchConversation}
            onRemoveConversation={chat.removeConversation}
          />
        </Sider>
      )}

      <Layout style={{ height: '100vh' }}>
        <AppHeader
          collapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
          sessionTitle={isKb ? '知识库管理' : 'AI 智能问答'}
        />
        <Content style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {isKb ? (
            <KbManagePage />
          ) : (
            <ChatPanel
              messages={chat.messages ?? []}
              isLoading={chat.isLoading ?? false}
              currentTool={chat.currentTool ?? null}
              onSendChat={chat.sendChat}
            />
          )}
        </Content>
      </Layout>
    </Layout>
  )
}

// ============================================================
// AdminLayout — header only, no sidebar (for admin pages)
// ============================================================

function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f5f5' }}>
      <AppHeader
        collapsed={false}
        onToggleSidebar={() => {}}
        sessionTitle="用户管理"
      />
      <Content style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ height: '100%', padding: '32px', overflow: 'auto' }}>
          {children}
        </div>
      </Content>
    </div>
  )
}

// ============================================================
// App — Root component with routing
// ============================================================

export default function App() {
  return (
    <BrowserRouter>
      <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#4F46E5', borderRadius: 10 } }}>
        <ChatProvider>
          <Routes>
            <Route path="/" element={<LoginPageWrapper />} />

            <Route
              path="/chat"
              element={
                <ProtectedRoute>
                  <ChatLayout />
                </ProtectedRoute>
              }
            />

            <Route
              path="/knowledge-base"
              element={
                <ProtectedRoute>
                  <ChatLayout />
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin/users"
              element={
                <ProtectedRoute requireAdmin>
                  <AdminLayout>
                    <UserManagePage />
                  </AdminLayout>
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ChatProvider>
      </ConfigProvider>
    </BrowserRouter>
  )
}
