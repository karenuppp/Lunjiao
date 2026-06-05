import type { ChatRequest, ChatResponse, Conversation, DataSource } from '../types/chat'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

export async function loginUser(account: string, password: string): Promise<{
  ok: boolean
  user_id?: string
  role?: string
  error?: string
}> {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function sendChat(request: ChatRequest): Promise<ChatResponse> {
  const res = await fetch(`${BASE_URL}/chat/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

export function sendChatStream(
  request: ChatRequest,
  onMessage: (eventType: string, data: Record<string, unknown>) => void,
): { abort: () => void } {
  const controller = new AbortController()

  fetch(`${BASE_URL}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No readable stream')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        if (controller.signal.aborted) break
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const rawEvent of lines) {
          if (!rawEvent.trim()) continue
          const parts = rawEvent.split('\n')
          let eventType = ''
          let jsonData: Record<string, unknown> = {}

          for (const part of parts) {
            if (part.startsWith('event: ')) {
              eventType = part.slice(7).trim()
            } else if (part.startsWith('data: ')) {
              try {
                jsonData = JSON.parse(part.slice(6))
              } catch {}
            }
          }

          onMessage(eventType, jsonData)
        }
      }
    })
    .catch((err) => {
      if (!controller.signal.aborted && err.name !== 'AbortError') {
        console.error('Stream error:', err)
        onMessage('error', { message: err.message || String(err) || '流式连接失败' })
      }
    })

  return { abort: () => controller.abort() }
}

export async function listConversations(userId?: string): Promise<Conversation[]> {
  const params = userId ? `?user_id=${encodeURIComponent(userId)}` : ''
  const res = await fetch(`${BASE_URL}/history/${params}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.conversations || []
}

export async function createConversation(title?: string, userId?: string): Promise<Conversation> {
  const res = await fetch(`${BASE_URL}/history/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, user_id: userId || 'default' }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/history/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function loadMessages(conversationId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}/history/${conversationId}/messages`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function listDataSources(): Promise<DataSource[]> {
  const res = await fetch(`${BASE_URL}/data-sources/`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export interface UploadedFileMeta {
  file_id: string
  file_name: string
  file_size: number
  file_type: string
  uploaded_at: string
  rag_status: 'indexed' | 'pending' | 'failed'
  rag_error?: string
  user_id?: string
  category?: string
}

export async function listUploadedFiles(opts?: {
  scope?: 'all' | 'public' | 'personal'
  user_id?: string
  keyword?: string
}): Promise<UploadedFileMeta[]> {
  const params = new URLSearchParams()
  if (opts?.scope) params.set('scope', opts.scope)
  if (opts?.user_id) params.set('user_id', opts.user_id)
  if (opts?.keyword) params.set('keyword', opts.keyword)

  const url = `${BASE_URL}/upload/files?${params.toString()}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.files || []
}

export async function deleteUploadedFile(fileId: string, userId?: string): Promise<void> {
  const url = `${BASE_URL}/upload/files/${fileId}${userId ? `?user_id=${encodeURIComponent(userId)}` : ''}`
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function updateFileCategory(fileId: string, category: string): Promise<void> {
  const formData = new FormData()
  formData.append('category', category)
  const res = await fetch(`${BASE_URL}/upload/files/${fileId}/category`, {
    method: 'PUT',
    body: formData,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export interface BatchUploadResult {
  files: UploadedFileMeta[]
  errors: { filename: string; error: string }[]
  total: number
  success_count: number
}

export async function uploadFilesBatch(files: File[]): Promise<BatchUploadResult> {
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }

  const res = await fetch(`${BASE_URL}/upload/batch`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

export async function uploadFilesBatchWithUser(
  files: File[],
  userId: string,
  category: string = '',
): Promise<BatchUploadResult> {
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }
  formData.append('user_id', userId)
  formData.append('category', category)

  const res = await fetch(`${BASE_URL}/upload/batch`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

export function isArchiveFile(filename: string): boolean {
  const ext = filename.toLowerCase()
  return ext.endsWith('.zip') || ext.endsWith('.rar') || ext.endsWith('.7z') || ext.endsWith('.tar.gz') || ext.endsWith('.tgz')
}

export interface DbFieldInfo {
  name: string
  type: string
}

export interface DbConnectionRecord {
  id: number
  name: string
  host: string
  port: number
  table_name: string
  db_user: string
  db_name: string | null
  status: 'connected' | 'disconnected'
  table_fields: DbFieldInfo[] | null
  created_at: string
}

export interface TestConnectionResult {
  success: boolean
  message: string
  fields: DbFieldInfo[]
}

export async function listDbConnections(): Promise<DbConnectionRecord[]> {
  const res = await fetch(`${BASE_URL}/db-connections/`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function createDbConnection(payload: {
  name: string
  host: string
  port: number
  db_name: string
  table_name: string
  db_user: string
  db_password: string
}): Promise<DbConnectionRecord> {
  const res = await fetch(`${BASE_URL}/db-connections/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function testDbConnection(payload: {
  name: string
  host: string
  port: number
  db_name: string
  table_name: string
  db_user: string
  db_password: string
}): Promise<TestConnectionResult> {
  const res = await fetch(`${BASE_URL}/db-connections/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function testSavedDbConnection(connId: number): Promise<TestConnectionResult> {
  const res = await fetch(`${BASE_URL}/db-connections/${connId}/test`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function disconnectDbConnection(connId: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/db-connections/${connId}/disconnect`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function connectDbConnection(connId: number): Promise<{ message: string; status: string }> {
  const res = await fetch(`${BASE_URL}/db-connections/${connId}/connect`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function deleteDbConnection(connId: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/db-connections/${connId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export interface UserRecord {
  id: number
  account: string
  role: string
  kb_scope: string
  db_scope: number[] | null
  exp_extract_enabled: boolean
}

export interface QueryPermission {
  kb_scope: string
  db_scope: number[] | null
  exp_extract_enabled?: boolean
}

export async function listUsers(): Promise<UserRecord[]> {
  const userId = localStorage.getItem('zhiwei_user_id') || ''
  const res = await fetch(`${BASE_URL}/auth/users?user_id=${encodeURIComponent(userId)}`)
  if (res.status === 403) throw new Error('无权限访问')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function createUser(account: string, password: string, role: string): Promise<void> {
  const userId = localStorage.getItem('zhiwei_user_id') || ''
  const res = await fetch(`${BASE_URL}/auth/users?user_id=${encodeURIComponent(userId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password, role }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as any).detail || `HTTP ${res.status}`)
  }
}

export async function deleteUser(userId: number): Promise<void> {
  const callerId = localStorage.getItem('zhiwei_user_id') || ''
  const res = await fetch(`${BASE_URL}/auth/users/${userId}?caller_id=${encodeURIComponent(callerId)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function changeUserPassword(userId: number, newPassword: string): Promise<void> {
  const callerId = localStorage.getItem('zhiwei_user_id') || ''
  const res = await fetch(`${BASE_URL}/auth/users/${userId}/change-password?caller_id=${encodeURIComponent(callerId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_password: newPassword }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as any).detail || `HTTP ${res.status}`)
  }
}

export async function getUserQueryPermission(userId: number): Promise<QueryPermission> {
  const callerId = localStorage.getItem('zhiwei_user_id') || ''
  const res = await fetch(
    `${BASE_URL}/auth/users/${userId}/query-permission?caller_id=${encodeURIComponent(callerId)}`,
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export interface PromptRecord {
  key: string
  content: string
  updated_at: string | null
}

export async function getSystemPrompt(): Promise<PromptRecord> {
  const res = await fetch(`${BASE_URL}/prompt`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function updateSystemPrompt(content: string): Promise<{ ok: boolean; key: string; updated_at: string }> {
  const res = await fetch(`${BASE_URL}/prompt`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as any).detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function resetSystemPrompt(): Promise<{ ok: boolean; content: string; updated_at: string }> {
  const res = await fetch(`${BASE_URL}/prompt/reset`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export interface PromptTemplate {
  id: number
  prompt_key: string
  title: string
  content: string
  updated_at: string | null
}

export async function listPromptTemplates(): Promise<PromptTemplate[]> {
  const res = await fetch(`${BASE_URL}/prompts`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function createPromptTemplate(title: string, content: string): Promise<PromptTemplate> {
  const res = await fetch(`${BASE_URL}/prompts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as any).detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function updatePromptTemplate(id: number, payload: { title?: string; content?: string }): Promise<PromptTemplate> {
  const res = await fetch(`${BASE_URL}/prompts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as any).detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function deletePromptTemplate(id: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/prompts/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as any).detail || `HTTP ${res.status}`)
  }
}

export async function sendFeedback(
  conversationId: string,
  messageId: string,
  rating: 'up' | 'down',
  userId?: string,
): Promise<{ ok: boolean; rating: string }> {
  const res = await fetch(`${BASE_URL}/chat/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: conversationId,
      message_id: messageId,
      rating,
      user_id: userId || localStorage.getItem('zhiwei_user_id') || 'default',
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export interface ExperienceRecord {
  id: number
  user_id: string
  title: string
  content: string
  source_conv_id: string | null
  source_msg_id: string | null
  tags: string[]
  confidence: number
  status: string
  access_count: number
  last_accessed: string | null
  created_at: string | null
  updated_at: string | null
}

export async function listExperiences(params?: {
  page?: number
  page_size?: number
  user_id?: string
  status?: string
}): Promise<{ items: ExperienceRecord[]; total: number; page: number; page_size: number }> {
  const searchParams = new URLSearchParams()
  if (params?.page) searchParams.set('page', String(params.page))
  if (params?.page_size) searchParams.set('page_size', String(params.page_size))
  if (params?.user_id) searchParams.set('user_id', params.user_id)
  if (params?.status) searchParams.set('status', params.status)

  const res = await fetch(`${BASE_URL}/experiences?${searchParams.toString()}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function updateExperience(
  id: number,
  payload: { title?: string; content?: string; tags?: string[]; status?: string },
): Promise<{ ok: boolean; experience: ExperienceRecord }> {
  const res = await fetch(`${BASE_URL}/experiences/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function deleteExperience(id: number): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE_URL}/experiences/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function getExperienceTags(): Promise<{ tags: string[] }> {
  const res = await fetch(`${BASE_URL}/experiences/tags`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function setUserQueryPermission(
  userId: number,
  payload: QueryPermission,
): Promise<void> {
  const callerId = localStorage.getItem('zhiwei_user_id') || ''
  const res = await fetch(
    `${BASE_URL}/auth/users/${userId}/query-permission?caller_id=${encodeURIComponent(callerId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kb_scope: payload.kb_scope,
        db_scope: payload.db_scope,
        exp_extract_enabled: payload.exp_extract_enabled,
      }),
    },
  )
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as any).detail || `HTTP ${res.status}`)
  }
}

export async function approveExperience(expId: number): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE_URL}/experiences/${expId}/approve`, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function rejectExperience(expId: number): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE_URL}/experiences/${expId}/reject`, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export interface ExperienceSuggestPayload {
  user_question: string
  ai_answer: string
  user_id: string
  conv_id: string
  msg_id: string
  data_sources?: string[]
  category?: string
}

export async function saveSuggestedExperience(payload: ExperienceSuggestPayload): Promise<{ ok: boolean; extracted: number }> {
  const res = await fetch(`${BASE_URL}/experiences/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function dismissExperienceSuggestion(convId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE_URL}/experiences/suggest/dismiss`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export interface SkillRecord {
  id: number
  title: string
  description: string
  content: string
  created_by: string
  created_at: string | null
  updated_at: string | null
}

export async function listSkills(): Promise<SkillRecord[]> {
  const res = await fetch(`${BASE_URL}/skills`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function createSkill(title: string, content: string, createdBy?: string): Promise<SkillRecord> {
  const res = await fetch(`${BASE_URL}/skills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content, created_by: createdBy || 'admin' }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as any).detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function updateSkill(id: number, payload: { title?: string; content?: string }): Promise<SkillRecord> {
  const res = await fetch(`${BASE_URL}/skills/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as any).detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function deleteSkill(id: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/skills/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as any).detail || `HTTP ${res.status}`)
  }
}

export async function generateSkill(title: string, requirement: string): Promise<{ ok: boolean; content: string; description: string }> {
  const res = await fetch(`${BASE_URL}/skills/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, requirement }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as any).detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export interface SearchResult {
  conversation_id: string
  conversation_title: string
  message_id: string
  role: string
  excerpt: string
  keyword: string
  created_at: string
}

export async function searchMessages(keyword: string, userId?: string): Promise<{ results: SearchResult[] }> {
  const params = new URLSearchParams({ keyword })
  if (userId) params.set('user_id', userId)
  const res = await fetch(`${BASE_URL}/history/search?${params.toString()}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function submitOpinion(content: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE_URL}/opinion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
