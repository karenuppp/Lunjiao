/**
 * HTTP API client — wraps all fetch calls to backend endpoints.
 */

import type { ChatRequest, ChatResponse, Conversation, DataSource } from '../types/chat'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'

// ============================================================
// Chat APIs
// ============================================================

/** Login — verify credentials against backend */
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

/** Send a non-streaming chat message */
export async function sendChat(request: ChatRequest): Promise<ChatResponse> {
  const res = await fetch(`${BASE_URL}/chat/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

/** Send a streaming chat message — returns SSE reader */
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
      }
    })

  return { abort: () => controller.abort() }
}

// ============================================================
// Conversation / History APIs
// ============================================================

export async function listConversations(): Promise<Conversation[]> {
  const res = await fetch(`${BASE_URL}/history/`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.conversations || []
}

export async function createConversation(title?: string): Promise<Conversation> {
  const res = await fetch(`${BASE_URL}/history/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/history/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

/** Load messages for a specific conversation */
export async function loadMessages(conversationId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}/history/${conversationId}/messages`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ============================================================
// Data Source APIs
// ============================================================

export async function listDataSources(): Promise<DataSource[]> {
  const res = await fetch(`${BASE_URL}/data-sources/`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ============================================================
// File Upload APIs
// ============================================================

export interface UploadedFileMeta {
  file_id: string
  file_name: string
  file_size: number
  file_type: string
  uploaded_at: string
  rag_status: 'indexed' | 'pending' | 'failed'
  rag_error?: string
  user_id?: string
}

/** List files with optional scope filtering and keyword search. */
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

// ============================================================
// Batch Upload — multiple files at once
// ============================================================

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

/** Batch upload with user_id and category for personal knowledge base. */
export async function uploadFilesBatchWithUser(
  files: File[],
  userId: string,
  category: string = '上传文件',
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

/** Check if filename is a compressed archive (handled by backend). */
export function isArchiveFile(filename: string): boolean {
  const ext = filename.toLowerCase()
  return ext.endsWith('.zip') || ext.endsWith('.rar') || ext.endsWith('.7z') || ext.endsWith('.tar.gz') || ext.endsWith('.tgz')
}

// ============================================================
// Database Connection APIs
// ============================================================

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
}

export interface QueryPermission {
  kb_scope: string
  db_scope: number[] | null
}

/** List all users (admin only). Returns 403 if caller is not admin. */
export async function listUsers(): Promise<UserRecord[]> {
  const userId = localStorage.getItem('lunjiao_user_id') || ''
  const res = await fetch(`${BASE_URL}/auth/users?user_id=${encodeURIComponent(userId)}`)
  if (res.status === 403) throw new Error('无权限访问')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** Create a new user (admin only). */
export async function createUser(account: string, password: string, role: string): Promise<void> {
  const userId = localStorage.getItem('lunjiao_user_id') || ''
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

/** Delete a user by id (admin only). */
export async function deleteUser(userId: number): Promise<void> {
  const callerId = localStorage.getItem('lunjiao_user_id') || ''
  const res = await fetch(`${BASE_URL}/auth/users/${userId}?caller_id=${encodeURIComponent(callerId)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

/** Change user password (admin only). */
export async function changeUserPassword(userId: number, newPassword: string): Promise<void> {
  const callerId = localStorage.getItem('lunjiao_user_id') || ''
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

/** Get user query permission (admin only). */
export async function getUserQueryPermission(userId: number): Promise<QueryPermission> {
  const callerId = localStorage.getItem('lunjiao_user_id') || ''
  const res = await fetch(
    `${BASE_URL}/auth/users/${userId}/query-permission?caller_id=${encodeURIComponent(callerId)}`,
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ============================================================
// System Prompt APIs
// ============================================================

export interface PromptRecord {
  key: string
  content: string
  updated_at: string | null
}

/** Get current system prompt. */
export async function getSystemPrompt(): Promise<PromptRecord> {
  const res = await fetch(`${BASE_URL}/prompt`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** Update system prompt (admin only). */
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

/** Reset system prompt to built-in default. */
export async function resetSystemPrompt(): Promise<{ ok: boolean; content: string; updated_at: string }> {
  const res = await fetch(`${BASE_URL}/prompt/reset`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** Set user query permission (admin only). */
export async function setUserQueryPermission(
  userId: number,
  payload: QueryPermission,
): Promise<void> {
  const callerId = localStorage.getItem('lunjiao_user_id') || ''
  const res = await fetch(
    `${BASE_URL}/auth/users/${userId}/query-permission?caller_id=${encodeURIComponent(callerId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as any).detail || `HTTP ${res.status}`)
  }
}
