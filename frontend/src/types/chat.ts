/**
 * TypeScript type definitions for Lunjiao department Q&A system.
 */

// ============================================================
// Conversation & Message Types
// ============================================================

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  data_sources_used?: string[]
  chart_config?: Record<string, unknown>
  report_text?: string
  created_at?: string
}

export interface Conversation {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
  messages?: Message[]
}

// ============================================================
// Chat Request / Response Types
// ============================================================

export interface ChatRequest {
  message: string
  conversation_id?: string | null
  data_category?: string[]
  data_sources?: string[]
  response_mode?: 'text' | 'chart' | 'all'
  history?: Array<{ role: string; content: string }>
  user_id?: string
}

export interface ChatResponse {
  answer: string
  conversation_id: string
  data_sources_used?: string[]
  chart_config?: Record<string, unknown>
  report_text?: string
}

// ============================================================
// SSE Event Types
// ============================================================

export type SSEEventType =
  | 'connected'
  | 'token'
  | 'tool_call_start'
  | 'tool_call_end'
  | 'data_source'
  | 'final_answer'
  | 'error'

export interface SSEConnectedEvent {
  conversation_id: string
}

export interface SSETokenEvent {
  text: string
}

export interface SSEResponseEvent {
  [key: string]: unknown
}

// ============================================================
// Data Source Types
// ============================================================

export type DataSourceType = 'database' | 'upload'
export type DataSourceStatus = 'connected' | 'disconnected'

export interface DataSource {
  id: string
  name: string
  type: DataSourceType
  status: DataSourceStatus
  description?: string
  created_at?: string
}

// ============================================================
// UI State Types
// ============================================================

/** User info from login */
export interface UserInfo {
  user_id: string
  role: 'admin' | 'user'
}

export type DataCategory = '全部' | '人事数据' | '设备数据' | '财务数据'

export interface UploadedFile {
  fileId: string
  fileName: string
  fileSize: number
  ragStatus: string
}

export interface ChatState {
  conversations: Conversation[]
  activeConversationId: string | null
  messages: Message[]
  isLoading: boolean
  streamingContent: string
  currentTool: string | null
  selectedCategory: DataCategory[]
}

// ============================================================
// File Upload / Knowledge Base Types
// ============================================================

/** App view mode */
export type AppView = 'chat' | 'kb'

/** KbManagePage tab */
export type KbTab = 'upload' | 'files'

/** A file selected by user but not yet uploaded */
export interface PendingFile {
  uid: string             // unique local id for list rendering
  file: File              // browser File object
  name: string
  size: number
  isArchive: boolean      // whether it's a compressed archive (.zip/.rar/.7z/.tar.gz)
}

/** Status of an upload-in-progress entry */
export type FileUploadStatus = 'waiting' | 'uploading' | 'unpacking' | 'indexing' | 'done' | 'error'

export interface UploadProgressItem {
  uid: string
  name: string
  status: FileUploadStatus
  error?: string
  /** For archives: children files extracted */
  archiveChildren?: { name: string; status: FileUploadStatus; error?: string }[]
}

// ============================================================
// Chart Types (for ECharts rendering)
// ============================================================

export interface ChartSeries {
  name: string
  type: 'bar' | 'line' | 'pie' | 'area' | 'scatter'
  data: number[] | Array<{ value: number; name: string }>
  smooth?: boolean
  yAxisIndex?: number
}

export interface EChartConfig {
  title: { text: string }
  tooltip?: { trigger: 'axis' | 'item' }
  xAxis?: { type: 'category'; data: string[] }
  yAxis?: { type: 'value' }
  series: ChartSeries[]
}
