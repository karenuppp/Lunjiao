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
              } catch { /* ignore non-JSON */ }
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

