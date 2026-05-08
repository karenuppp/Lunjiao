import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  useMemo,
  useEffect,
  type ReactNode,
} from 'react'
import type { DataCategory } from '../types/chat'
import { sendChatStream } from '../api/chat'

// ============================================================
// Persist conversations to localStorage
// ============================================================

const STORAGE_KEY = 'lunjiao_conversations'

function saveToStorage(state: ChatState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      conversations: state.conversations,
      activeConversationId: state.activeConversationId,
      uploadedFiles: state.uploadedFiles,
    }))
  } catch { /* quota exceeded or private browsing */ }
}

function loadFromStorage(): Partial<ChatState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const data = JSON.parse(raw)
    return {
      conversations: data.conversations ?? [],
      activeConversationId: data.activeConversationId ?? null,
      uploadedFiles: data.uploadedFiles ?? [],
    }
  } catch {
    return {}
  }
}

// ============================================================
// State
// ============================================================

interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
}

interface ChatState {
  conversations: Conversation[]
  activeConversationId: string | null
  isLoading: boolean
  selectedCategory: DataCategory[]
  currentTool: string | null
  uploadedFiles: UploadedFileMeta[]
}

interface UploadedFileMeta {
  fileId: string
  fileName: string
  fileSize: number
  ragStatus: string
}

const initialState: ChatState = {
  conversations: [],
  activeConversationId: null,
  isLoading: false,
  selectedCategory: ['全部'],
  currentTool: null,
  uploadedFiles: [],
}

// Merge persisted data into initial state
const persisted = loadFromStorage()
const mergedInitial: ChatState = {
  ...initialState,
  conversations: persisted.conversations ?? initialState.conversations,
  activeConversationId: persisted.activeConversationId ?? initialState.activeConversationId,
  uploadedFiles: persisted.uploadedFiles ?? initialState.uploadedFiles,
}

// ============================================================
// Actions
// ============================================================

type ChatAction =
  | { type: 'NEW_CONVERSATION'; payload: { id: string; title: string } }
  | { type: 'SWITCH_CONVERSATION'; payload: { id: string | null } }
  | { type: 'ADD_MESSAGE'; payload: { conversationId: string; message: ChatMessage } }
  | { type: 'APPEND_STREAMING'; payload: { conversationId: string; text: string } }
  | { type: 'FINALIZE_STREAMING'; payload: { conversationId: string; finalText: string; dataSources?: string[] } }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_CURRENT_TOOL'; payload: string | null }
  | { type: 'SET_CATEGORY'; payload: DataCategory[] }
  | { type: 'REMOVE_CONVERSATION'; payload: string }
  | { type: 'ADD_UPLOADED_FILE'; payload: UploadedFileMeta }
  | { type: 'REMOVE_UPLOADED_FILE'; payload: string }
  | { type: 'RENAME_CONVERSATION'; payload: { id: string; title: string } }

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'RENAME_CONVERSATION':
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === action.payload.id ? { ...c, title: action.payload.title } : c,
        ),
      }

    case 'NEW_CONVERSATION':
      return {
        ...state,
        conversations: [
          { id: action.payload.id, title: action.payload.title, messages: [] },
          ...state.conversations,
        ],
        activeConversationId: action.payload.id,
      }

    case 'SWITCH_CONVERSATION':
      return { ...state, activeConversationId: action.payload.id }

    case 'ADD_MESSAGE': {
      const { conversationId, message } = action.payload
      return {
        ...state,
        conversations: state.conversations.map((conv) =>
          conv.id === conversationId
            ? { ...conv, messages: [...conv.messages, message] }
            : conv
        ),
      }
    }

    case 'APPEND_STREAMING': {
      const { conversationId, text } = action.payload
      return {
        ...state,
        conversations: state.conversations.map((conv) => {
          if (conv.id !== conversationId) return conv
          const msgs = [...conv.messages]
          const lastMsg = msgs[msgs.length - 1]
          if (lastMsg && lastMsg.role === 'assistant') {
            msgs[msgs.length - 1] = { ...lastMsg, content: lastMsg.content + text }
          }
          return { ...conv, messages: msgs }
        }),
      }
    }

    case 'FINALIZE_STREAMING': {
      const { conversationId, finalText, dataSources } = action.payload
      return {
        ...state,
        isLoading: false,
        currentTool: null,
        conversations: state.conversations.map((conv) => {
          if (conv.id !== conversationId) return conv
          const msgs = [...conv.messages]
          const lastMsg = msgs[msgs.length - 1]
          if (lastMsg && lastMsg.role === 'assistant') {
            msgs[msgs.length - 1] = {
              ...lastMsg,
              content: finalText || lastMsg.content,
              data_sources_used: dataSources,
            }
          } else {
            msgs.push({
              id: `msg-${Date.now()}`,
              role: 'assistant',
              content: finalText || '',
              data_sources_used: dataSources,
            })
          }
          return { ...conv, messages: msgs }
        }),
      }
    }

    case 'SET_LOADING':
      return { ...state, isLoading: action.payload }

    case 'SET_CURRENT_TOOL':
      return { ...state, currentTool: action.payload }

    case 'SET_CATEGORY':
      return { ...state, selectedCategory: action.payload }

    case 'REMOVE_CONVERSATION':
      return {
        ...state,
        conversations: state.conversations.filter((c) => c.id !== action.payload),
        activeConversationId:
          state.activeConversationId === action.payload
            ? state.conversations.find((c) => c.id !== action.payload)?.id ?? null
            : state.activeConversationId,
      }

    case 'ADD_UPLOADED_FILE':
      return {
        ...state,
        uploadedFiles: [...state.uploadedFiles, action.payload],
      }

    case 'REMOVE_UPLOADED_FILE':
      return {
        ...state,
        uploadedFiles: state.uploadedFiles.filter(
          (f) => f.fileId !== action.payload
        ),
      }

    default:
      return state
  }
}

// ============================================================
// Context
// ============================================================

interface ChatContextValue {
  state: ChatState
  dispatch: React.Dispatch<ChatAction>
  sendChat: (message: string) => void
  newConversation: () => void
  switchConversation: (id: string | null) => void
  removeConversation: (id: string) => void
  setCategory: (cat: DataCategory[]) => void
  uploadFile: (file: File) => Promise<UploadedFileMeta | null>
  removeUploadedFile: (fileId: string) => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

// ============================================================
// Provider
// ============================================================

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, mergedInitial)
  const abortRef = useRef<(() => void) | null>(null)

  // Auto-persist to localStorage on every state change
  const persistedRef = useRef(state)
  persistedRef.current = state
  useEffect(() => {
    saveToStorage(persistedRef.current)
  })

  // ---- New conversation ----
  const newConversation = useCallback(() => {
    if (abortRef.current) abortRef.current()
    const id = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // Auto-title the previous conversation: find the last conversation with content,
    // extract its first user message (first 10 chars) as its title
    const prevConvs = persistedRef.current.conversations ?? []
    for (let i = prevConvs.length - 1; i >= 0; i--) {
      const conv = prevConvs[i]
      // Skip if this conversation already has a non-default title
      if (conv.title && conv.title !== '新对话') continue

      // Find the first user message in this conversation
      const firstUserMsg = conv.messages.find((m) => m.role === 'user' && m.content)
      if (firstUserMsg) {
        const clean = firstUserMsg.content.replace(/[\n\r]+/g, ' ').trim()
        const title = clean.length > 10 ? clean.slice(0, 10) + '…' : clean
        if (title) {
          dispatch({ type: 'RENAME_CONVERSATION', payload: { id: conv.id, title } })
        }
        break
      }
    }

    dispatch({ type: 'NEW_CONVERSATION', payload: { id, title: '新对话' } })
  }, [])

  // ---- Switch conversation ----
  const switchConversation = useCallback((id: string | null) => {
    if (abortRef.current) abortRef.current()
    dispatch({ type: 'SWITCH_CONVERSATION', payload: { id } })
  }, [])

  // ---- Remove conversation ----
  const removeConversation = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_CONVERSATION', payload: id })
  }, [])

  // ---- Set category ----
  const setCategory = useCallback((cat: DataCategory[]) => {
    dispatch({ type: 'SET_CATEGORY', payload: cat })
  }, [])

  // ---- Send chat (streaming) ----
  const sendChat = useCallback(
    (message: string) => {
      if (!message.trim() || state.isLoading) return

      // Ensure there's an active conversation
      let convId = state.activeConversationId
      if (!convId) {
        convId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        dispatch({
          type: 'NEW_CONVERSATION',
          payload: { id: convId, title: message.slice(0, 30) },
        })
      }

      // Add user message
      const userMsg: ChatMessage = {
        id: `msg-${Date.now()}-user`,
        role: 'user',
        content: message,
      }
      dispatch({ type: 'ADD_MESSAGE', payload: { conversationId: convId, message: userMsg } })

      // Add placeholder for assistant response (updated as stream arrives)
      dispatch({
        type: 'ADD_MESSAGE',
        payload: {
          conversationId: convId,
          message: { id: `msg-${Date.now()}-ai`, role: 'assistant', content: '' },
        },
      })

      dispatch({ type: 'SET_LOADING', payload: true })

      // Collect data sources from tool call events
      const dataSources: string[] = []

      // Start streaming
      const controller = sendChatStream(
        {
          message,
          conversation_id: convId,
          history: undefined, // backend handles history internally for now
          user_id: localStorage.getItem('lunjiao_user_id') || 'default',
        },
        (eventType, data) => {
          switch (eventType) {
            case 'token':
              dispatch({
                type: 'APPEND_STREAMING',
                payload: { conversationId: convId!, text: (data.text as string) || '' },
              })
              break

            case 'tool_call_start':
              dispatch({
                type: 'SET_CURRENT_TOOL',
                payload: (data.label as string) || (data.tool as string) || '',
              })
              break

            case 'tool_call_end':
              dispatch({ type: 'SET_CURRENT_TOOL', payload: null })
              break

            case 'data_source': {
              const sources = (data.sources as string[]) || []
              sources.forEach((s: string) => {
                if (!dataSources.includes(s)) dataSources.push(s)
              })
              break
            }

            case 'final_answer': {
              const text = (data.text as string) || ''
              dispatch({
                type: 'FINALIZE_STREAMING',
                payload: {
                  conversationId: convId!,
                  finalText: text,
                  dataSources: dataSources.length > 0 ? dataSources : undefined,
                },
              })
              break
            }

            case 'error':
              console.error('Stream error:', data.message)
              dispatch({ type: 'FINALIZE_STREAMING', payload: { conversationId: convId!, finalText: `抱歉，处理出错了: ${data.message || '未知错误'}` } })
              break
          }
        }
      )

      abortRef.current = controller.abort
    },
    [state.isLoading, state.activeConversationId]
  )

  // ---- Upload file ----
  const uploadFile = useCallback(async (file: File, userId?: string): Promise<UploadedFileMeta | null> => {
    const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'
    const currentUserId = userId || localStorage.getItem('lunjiao_user_id') || 'default'
    const formData = new FormData()
    formData.append('file', file)
    formData.append('user_id', currentUserId)

    try {
      const res = await fetch(`${BASE_URL}/upload`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const errText = await res.text()
        console.error('Upload failed:', errText)
        return null
      }

      const data = await res.json()
      const meta: UploadedFileMeta = {
        fileId: data.file_id,
        fileName: data.file_name,
        fileSize: data.file_size,
        ragStatus: data.rag_status,
      }
      dispatch({ type: 'ADD_UPLOADED_FILE', payload: meta })
      return meta
    } catch (err) {
      console.error('Upload error:', err)
      return null
    }
  }, [])

  // ---- Remove uploaded file ----
  const removeUploadedFile = useCallback(async (fileId: string, userId?: string) => {
    const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'
    const currentUserId = userId || localStorage.getItem('lunjiao_user_id') || 'default'
    try {
      await fetch(`${BASE_URL}/upload/files/${fileId}?user_id=${encodeURIComponent(currentUserId)}`, { method: 'DELETE' })
    } catch { /* ignore */ }
    dispatch({ type: 'REMOVE_UPLOADED_FILE', payload: fileId })
  }, [])

  // ---- Computed values (accessed via hook) ----
  const value: ChatContextValue = {
    state,
    dispatch,
    sendChat,
    newConversation,
    switchConversation,
    removeConversation,
    setCategory,
    uploadFile,
    removeUploadedFile,
  }

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

// ============================================================
// Hook
// ============================================================

export function useChat() {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used within ChatProvider')
  return {
    // State
    messages: ctx.state.conversations.find((c) => c.id === ctx.state.activeConversationId)?.messages ?? [],
    conversations: ctx.state.conversations,
    isLoading: ctx.state.isLoading,
    activeConversationId: ctx.state.activeConversationId,
    selectedCategory: ctx.state.selectedCategory,
    currentTool: ctx.state.currentTool,
    uploadedFiles: ctx.state.uploadedFiles,
    // Actions
    sendChat: ctx.sendChat,
    newConversation: ctx.newConversation,
    switchConversation: ctx.switchConversation,
    removeConversation: ctx.removeConversation,
    setCategory: ctx.setCategory,
    uploadFile: ctx.uploadFile,
    removeUploadedFile: ctx.removeUploadedFile,
  }
}
