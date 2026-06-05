import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { Layout, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { ChatProvider, useChat } from './store/chatStore'
import { TourProvider, useTour } from './store/tourStore'
import TourBubble from './components/TourBubble'
import { ToastProvider } from './components/Toast'
import type { ReactNode } from 'react'
import type { UserInfo } from './types/chat'

import LoginPage from './components/LoginPage'
import Sidebar from './components/Sidebar'
import AppHeader from './components/AppHeader'
import ChatPanel from './components/ChatPanel'
import KbManagePage from './components/KbManagePage'
import DbManagePage from './components/DbManagePage'
import UserManagePage from './components/UserManagePage'
import PromptManagePage from './components/PromptManagePage'
import ExpManagePage from './components/ExpManagePage'
import SkillManagePage from './components/SkillManagePage'
import SearchModal from './components/SearchModal'

const { Sider, Content } = Layout

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

function ChatLayout() {
  const chat = useChat()
  const location = useLocation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [highlightMsgId, setHighlightMsgId] = useState<string | null>(null)
  const { tourActive, currentStep, steps, currentStepConfig, nextStep, closeTour } = useTour()

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
            onSearchClick={() => setSearchOpen(true)}
          />
        </Sider>
      )}

      <Layout style={{ height: '100vh' }}>
        <AppHeader
          collapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
          sessionTitle={isKb ? '知识库管理' : '智能问答'}
        />
        <Content style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {isKb ? (
            <KbManagePage />
          ) : (
            <ChatPanel
              messages={chat.messages ?? []}
              loadingConversationIds={chat.loadingConversationIds ?? []}
              activeConversationId={chat.activeConversationId ?? null}
              currentTool={chat.currentTool ?? null}
              highlightMessageId={highlightMsgId}
              onSendChat={(msg, _files, cat, visibleMsg, sysPrompt) => chat.sendChat(msg, cat, visibleMsg, cat, sysPrompt)}
              onFeedback={(msgId, rating) => chat.sendFeedback(msgId, rating)}
              onSaveExperienceSuggestion={(msgId) => chat.saveExperienceSuggestion(msgId)}
              onDismissExperienceSuggestion={(msgId) => chat.dismissExperienceSuggestion(msgId)}
              uploadFile={(file) => chat.uploadFile(file)}
            />
          )}
        </Content>
      </Layout>

      {tourActive && currentStepConfig && (
        <TourBubble
          step={currentStepConfig}
          stepIndex={currentStep}
          totalSteps={steps.length}
          onNext={nextStep}
          onClose={closeTour}
        />
      )}

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectResult={(convId, msgId) => {
          chat.switchConversation(convId)
          setHighlightMsgId(msgId)
          // Clear highlight after animation
          setTimeout(() => setHighlightMsgId(null), 2500)
        }}
      />
    </Layout>
  )
}

function AdminLayout({ children, title }: { children: ReactNode; title: string }) {
  const { tourActive, currentStep, steps, currentStepConfig, nextStep, closeTour } = useTour()

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f5f5' }}>
      <AppHeader
        collapsed={false}
        onToggleSidebar={() => {}}
        sessionTitle={title}
      />
      <Content style={{ flex: 1, overflow: 'hidden' }}>
        {children}
      </Content>

      {tourActive && currentStepConfig && (
        <TourBubble
          step={currentStepConfig}
          stepIndex={currentStep}
          totalSteps={steps.length}
          onNext={nextStep}
          onClose={closeTour}
        />
      )}
    </div>
  )
}

function AppInner() {
  const chat = useChat()
  return (
    <TourProvider role={chat.role || ''}>
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
              path="/admin/database"
              element={
                <ProtectedRoute requireAdmin>
                  <AdminLayout title="数据库管理">
                    <DbManagePage />
                  </AdminLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin/users"
              element={
                <ProtectedRoute requireAdmin>
                  <AdminLayout title="用户管理">
                    <UserManagePage />
                  </AdminLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin/prompt"
              element={
                <ProtectedRoute requireAdmin>
                  <AdminLayout title="提示词管理">
                    <PromptManagePage />
                  </AdminLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin/experience"
              element={
                <ProtectedRoute requireAdmin>
                  <AdminLayout title="经验管理">
                    <ExpManagePage />
                  </AdminLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin/skills"
              element={
                <ProtectedRoute requireAdmin>
                  <AdminLayout title="技能工厂">
                    <SkillManagePage />
                  </AdminLayout>
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
    </TourProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#4F46E5', borderRadius: 10 } }}>
        <ToastProvider>
        <ChatProvider>
          <AppInner />
        </ChatProvider>
        </ToastProvider>
      </ConfigProvider>
    </BrowserRouter>
  )
}
