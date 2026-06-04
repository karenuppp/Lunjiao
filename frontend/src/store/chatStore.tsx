import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from 'react'
import type { DataCategory, PendingFile, UploadProgressItem, AppView, UserInfo, Message as ChatMessage } from '../types/chat'
import { sendChatStream, isArchiveFile, uploadFilesBatchWithUser, loginUser, sendFeedback, listConversations, loadMessages, deleteConversation, saveSuggestedExperience, dismissExperienceSuggestion } from '../api/chat'

const STORAGE_KEY = 'zhiwei_conversations'

function saveToStorage(state: ChatState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      conversations: state.conversations,
      activeConversationId: state.activeConversationId,
      uploadedFiles: state.uploadedFiles,
    }))
  } catch { }
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
  appView: AppView
  pendingFiles: PendingFile[]
  uploadProgress: UploadProgressItem[]
  isUploading: boolean
  loggedIn: boolean
  userId: string
  role: string
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
  appView: 'chat',
  pendingFiles: [],
  uploadProgress: [],
  isUploading: false,
  loggedIn: false,
  userId: '',
  role: '',
}

const persisted = loadFromStorage()
const mergedInitial: ChatState = {
  ...initialState,
  conversations: persisted.conversations ?? initialState.conversations,
  activeConversationId: persisted.activeConversationId ?? initialState.activeConversationId,
  uploadedFiles: persisted.uploadedFiles ?? initialState.uploadedFiles,
}

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
  | { type: 'SET_VIEW'; payload: AppView }
  | { type: 'ADD_PENDING_FILES'; payload: PendingFile[] }
  | { type: 'REMOVE_PENDING_FILE'; payload: string }
  | { type: 'CLEAR_PENDING_FILES' }
  | { type: 'SET_UPLOADING'; payload: boolean }
  | { type: 'UPDATE_UPLOAD_PROGRESS'; payload: UploadProgressItem[] }
  | { type: 'CLEAR_UPLOAD_PROGRESS' }
  | { type: 'LOGIN'; payload: { userId: string; role: string } }
  | { type: 'LOGOUT' }
  | { type: 'SET_MESSAGE_FEEDBACK'; payload: { conversationId: string; messageId: string; rating: 'up' | 'down' } }
  | { type: 'SET_MESSAGE_ID'; payload: { conversationId: string; tempId: string; serverMessageId: string } }
  | { type: 'LOAD_CONVERSATIONS'; payload: { conversations: Conversation[] } }
  | { type: 'LOAD_MESSAGES'; payload: { conversationId: string; messages: ChatMessage[] } }
  | { type: 'SET_EXPERIENCE_SUGGEST'; payload: { conversationId: string; messageId: string; suggest: { topic: string; summary: string } | null } }

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

    case 'SET_VIEW':
      return { ...state, appView: action.payload }

    case 'ADD_PENDING_FILES':
      return {
        ...state,
        pendingFiles: [...state.pendingFiles, ...action.payload],
      }

    case 'REMOVE_PENDING_FILE':
      return {
        ...state,
        pendingFiles: state.pendingFiles.filter((f) => f.uid !== action.payload),
      }

    case 'CLEAR_PENDING_FILES':
      return { ...state, pendingFiles: [] }

    case 'SET_UPLOADING':
      return { ...state, isUploading: action.payload }

    case 'UPDATE_UPLOAD_PROGRESS':
      return { ...state, uploadProgress: action.payload }

    case 'CLEAR_UPLOAD_PROGRESS':
      return { ...state, uploadProgress: [] }

    case 'LOGIN':
      return { ...state, loggedIn: true, userId: action.payload.userId, role: action.payload.role }

    case 'LOGOUT':
      return { ...state, loggedIn: false, userId: '', role: '' }

    case 'SET_MESSAGE_FEEDBACK': {
      const { conversationId, messageId, rating } = action.payload
      return {
        ...state,
        conversations: state.conversations.map((conv) =>
          conv.id === conversationId
            ? {
                ...conv,
                messages: conv.messages.map((m) =>
                  m.id === messageId || (m as ChatMessage).message_id === messageId
                    ? { ...m, feedback_rating: rating }
                    : m,
                ),
              }
            : conv,
        ),
      }
    }

    case 'SET_MESSAGE_ID': {
      const { conversationId, tempId, serverMessageId } = action.payload
      return {
        ...state,
        conversations: state.conversations.map((conv) =>
          conv.id === conversationId
            ? {
                ...conv,
                messages: conv.messages.map((m) =>
                  m.id === tempId
                    ? { ...m, message_id: serverMessageId }
                    : m,
                ),
              }
            : conv,
        ),
      }
    }

    case 'LOAD_CONVERSATIONS':
      return { ...state, conversations: action.payload.conversations }

    case 'LOAD_MESSAGES':
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === action.payload.conversationId
            ? { ...c, messages: action.payload.messages }
            : c,
        ),
      }

    case 'SET_EXPERIENCE_SUGGEST':
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === action.payload.conversationId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === action.payload.messageId || (m as any).message_id === action.payload.messageId
                    ? { ...m, experience_suggest: action.payload.suggest }
                    : m,
                ),
              }
            : c,
        ),
      }

    default:
      return state
  }
}

interface ChatContextValue {
  state: ChatState
  dispatch: React.Dispatch<ChatAction>
  sendChat: (message: string, category?: string, visibleMessage?: string, templateName?: string) => void
  newConversation: () => void
  switchConversation: (id: string | null) => void
  removeConversation: (id: string) => void
  setCategory: (cat: DataCategory[]) => void
  uploadFile: (file: File) => Promise<UploadedFileMeta | null>
  removeUploadedFile: (fileId: string) => void
  setView: (view: AppView) => void
  addPendingFiles: (files: FileList | File[]) => void
  removePendingFile: (uid: string) => void
  clearPendingFiles: () => void
  clearUploadProgress: () => void
  confirmUpload: () => Promise<void>
  login: (account: string, password: string) => Promise<UserInfo>
  logout: () => void
  sendFeedback: (messageId: string, rating: 'up' | 'down') => void
  saveExperienceSuggestion: (messageId: string) => void
  dismissExperienceSuggestion: (messageId: string) => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, mergedInitial)
  const abortRef = useRef<(() => void) | null>(null)

  const persistedRef = useRef(state)
  const lastSaveRef = useRef(0)

  // Persist to localStorage on state change, throttled to once per 3s
  useEffect(() => {
    persistedRef.current = state
    const now = Date.now()
    if (now - lastSaveRef.current < 3000) return
    lastSaveRef.current = now
    saveToStorage(state)
  })

  // Final save on unmount / when conversations change settles
  useEffect(() => {
    const timer = setTimeout(() => {
      saveToStorage(persistedRef.current)
    }, 3500)
    return () => clearTimeout(timer)
  }, [state.conversations, state.activeConversationId])

  const newConversation = useCallback(() => {
    if (abortRef.current) abortRef.current()
    const id = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // Auto-title the previous conversation with the first user message's first 10 chars
    const prevConvs = persistedRef.current.conversations ?? []
    for (let i = prevConvs.length - 1; i >= 0; i--) {
      const conv = prevConvs[i]
      if (conv.title && conv.title !== '新对话') continue


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

  const switchConversation = useCallback(async (id: string | null) => {
    if (abortRef.current) abortRef.current()
    dispatch({ type: 'SWITCH_CONVERSATION', payload: { id } })

    // Lazy-load messages from server if not already loaded
    if (id) {
      const conv = persistedRef.current.conversations.find((c) => c.id === id)
      if (conv && conv.messages.length === 0) {
        try {
          const data = await loadMessages(id)
          const msgs = (data.messages || []) as ChatMessage[]
          dispatch({ type: 'LOAD_MESSAGES', payload: { conversationId: id, messages: msgs } })
        } catch (err) {
          console.error('Failed to load messages:', err)
        }
      }
    }
  }, [])

  const removeConversation = useCallback(async (id: string) => {
    dispatch({ type: 'REMOVE_CONVERSATION', payload: id })
    try {
      await deleteConversation(id)
    } catch (err) {
      console.error('Failed to delete conversation on server:', err)
    }
  }, [])

  const setCategory = useCallback((cat: DataCategory[]) => {
    dispatch({ type: 'SET_CATEGORY', payload: cat })
  }, [])

  const sendChat = useCallback(
    (message: string, category?: string, visibleMessage?: string, templateName?: string) => {
      if (!message.trim() || state.isLoading) return

      let convId = state.activeConversationId
      if (!convId) {
        convId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        dispatch({
          type: 'NEW_CONVERSATION',
          payload: { id: convId, title: (visibleMessage || message).slice(0, 30) },
        })
      }

      // Show only visible message in UI (template hidden)
      const displayContent = visibleMessage || message
      const userMsg: ChatMessage = {
        id: `msg-${Date.now()}-user`,
        role: 'user',
        content: displayContent,
        template_name: templateName || undefined,
      }
      dispatch({ type: 'ADD_MESSAGE', payload: { conversationId: convId, message: userMsg } })

      dispatch({
        type: 'ADD_MESSAGE',
        payload: {
          conversationId: convId,
          message: { id: `msg-${Date.now()}-ai`, role: 'assistant', content: '' },
        },
      })

      dispatch({ type: 'SET_LOADING', payload: true })

      const dataSources: string[] = []

      const controller = sendChatStream(
        {
          message,
          conversation_id: convId,
          history: undefined,
          user_id: localStorage.getItem('zhiwei_user_id') || 'default',
          category: category || undefined,
        },
        (eventType, data) => {
          switch (eventType) {
            case 'text_delta':
            case 'token':
              dispatch({
                type: 'APPEND_STREAMING',
                payload: { conversationId: convId!, text: (data.delta as string) || (data.text as string) || '' },
              })
              break

            case 'reply_start':
              // New event: agent reply started. conversation_id already set.
              // Ignore for now — future: use for AG-UI rendering.
              break

            case 'tool_call_start':
              dispatch({
                type: 'SET_CURRENT_TOOL',
                payload: (data.tool_label as string) || (data.label as string) || (data.tool_name as string) || (data.tool as string) || '',
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
              const serverMsgId = (data.message_id as string) || ''
              dispatch({
                type: 'FINALIZE_STREAMING',
                payload: {
                  conversationId: convId!,
                  finalText: text,
                  dataSources: dataSources.length > 0 ? dataSources : undefined,
                },
              })
              if (serverMsgId) {
                const conv = persistedRef.current.conversations.find(c => c.id === convId)
                const lastMsg = conv?.messages[conv.messages.length - 1]
                if (lastMsg && lastMsg.role === 'assistant') {
                  dispatch({
                    type: 'SET_MESSAGE_ID',
                    payload: { conversationId: convId!, tempId: lastMsg.id, serverMessageId: serverMsgId },
                  })
                }
              }
              break
            }

            case 'experience_suggest': {
              const serverMsgId = (data.message_id as string) || ''
              if (serverMsgId) {
                dispatch({
                  type: 'SET_EXPERIENCE_SUGGEST',
                  payload: {
                    conversationId: convId!,
                    messageId: serverMsgId,
                    suggest: {
                      topic: (data.topic as string) || '',
                      summary: (data.summary as string) || '',
                    },
                  },
                })
              }
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

  const uploadFile = useCallback(async (file: File, userId?: string): Promise<UploadedFileMeta | null> => {
    const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'
    const currentUserId = userId || localStorage.getItem('zhiwei_user_id') || 'default'
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

  const removeUploadedFile = useCallback(async (fileId: string, userId?: string) => {
    const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'
    const currentUserId = userId || localStorage.getItem('zhiwei_user_id') || 'default'
    try {
      await fetch(`${BASE_URL}/upload/files/${fileId}?user_id=${encodeURIComponent(currentUserId)}`, { method: 'DELETE' })
    } catch {}
    dispatch({ type: 'REMOVE_UPLOADED_FILE', payload: fileId })
  }, [])

  const setView = useCallback((view: AppView) => {
    dispatch({ type: 'SET_VIEW', payload: view })
  }, [])

  const addPendingFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files)
    const pending: PendingFile[] = arr.map((f) => ({
      uid: `pf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file: f,
      name: f.name,
      size: f.size,
      isArchive: isArchiveFile(f.name),
    }))
    dispatch({ type: 'ADD_PENDING_FILES', payload: pending })
  }, [])

  const removePendingFile = useCallback((uid: string) => {
    dispatch({ type: 'REMOVE_PENDING_FILE', payload: uid })
  }, [])

  const clearPendingFiles = useCallback(() => {
    dispatch({ type: 'CLEAR_PENDING_FILES' })
  }, [])

  const clearUploadProgress = useCallback(() => {
    dispatch({ type: 'CLEAR_UPLOAD_PROGRESS' })
  }, [])

  const confirmUpload = useCallback(async () => {
    const pending = persistedRef.current.pendingFiles
    if (pending.length === 0) return

    const userId = localStorage.getItem('zhiwei_user_id') || 'default'

    const progress = pending.map<UploadProgressItem>((pf) => ({
      uid: pf.uid,
      name: pf.name,
      status: 'waiting',
      archiveChildren: pf.isArchive ? [] : undefined,
    }))
    dispatch({ type: 'SET_UPLOADING', payload: true })
    dispatch({ type: 'UPDATE_UPLOAD_PROGRESS', payload: progress })

    const files = pending.map((pf) => pf.file)

    try {
      const result = await uploadFilesBatchWithUser(files, userId)

      const updated: UploadProgressItem[] = pending.map((pf) => {
        const match = result.files.find((f: any) => f.file_name === pf.name) as any
        if (match) {
          const archiveChildren = match.is_archive && match.extracted_files?.length
            ? match.extracted_files.map((ef: any) => ({
                name: ef.name,
                status: ef.status === 'done' ? 'done' as const : 'error' as const,
                error: ef.error,
              }))
            : undefined
          return {
            uid: pf.uid,
            name: pf.name,
            status: match.rag_status === 'indexed' ? 'done' as const : 'error' as const,
            error: match.rag_status === 'failed'
              ? (match.rag_error || '索引失败（未知原因）')
              : match.rag_status === 'pending'
                ? '索引超时，仍在处理中'
                : undefined,
            archiveChildren,
          } as UploadProgressItem
        }
        const errMatch = result.errors.find((e) => e.filename === pf.name)
        if (errMatch) {
          return { uid: pf.uid, name: pf.name, status: 'error', error: errMatch.error }
        }
        return { uid: pf.uid, name: pf.name, status: 'error', error: '未知错误' }
      })
      dispatch({ type: 'UPDATE_UPLOAD_PROGRESS', payload: updated })

      for (const f of result.files) {
        dispatch({
          type: 'ADD_UPLOADED_FILE',
          payload: {
            fileId: f.file_id,
            fileName: f.file_name,
            fileSize: f.file_size,
            ragStatus: f.rag_status,
          },
        })
      }
    } catch (err) {
      const updated: UploadProgressItem[] = pending.map((pf) => ({
        uid: pf.uid,
        name: pf.name,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      }))
      dispatch({ type: 'UPDATE_UPLOAD_PROGRESS', payload: updated })
    } finally {
      dispatch({ type: 'SET_UPLOADING', payload: false })
    }
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('zhiwei_user_id')
    localStorage.removeItem('zhiwei_role')
    if (abortRef.current) abortRef.current()
    dispatch({ type: 'LOGOUT' })
  }, [])

  const login = useCallback(async (account: string, password: string): Promise<UserInfo> => {
    const res = await loginUser(account, password)
    if (!res.ok) {
      throw new Error(res.error || '登录失败')
    }
    const userId = res.user_id || account
    const role = res.role || 'user'
    localStorage.setItem('zhiwei_user_id', userId)
    localStorage.setItem('zhiwei_role', role)
    dispatch({ type: 'LOGIN', payload: { userId, role } })

    // Load user's conversations from server
    try {
      const serverConvs = await listConversations(userId)
      const conversations: Conversation[] = serverConvs.map((c) => ({
        id: c.id,
        title: c.title || '未命名对话',
        messages: [],
      }))
      dispatch({ type: 'LOAD_CONVERSATIONS', payload: { conversations } })
    } catch (err) {
      console.error('Failed to load conversations from server:', err)
    }

    return { user_id: userId, role: role as 'admin' | 'user' }
  }, [])

  const saveExperienceSuggestionAction = useCallback(
    async (messageId: string) => {
      const convId = persistedRef.current.activeConversationId
      if (!convId) return
      const conv = persistedRef.current.conversations.find((c) => c.id === convId)
      if (!conv) return

      // Find user message and AI message
      const aiMsg = conv.messages.find((m) => m.id === messageId || (m as any).message_id === messageId)
      if (!aiMsg || !(aiMsg as any).experience_suggest) return
      const userMsg = conv.messages.filter((m) => m.role === 'user').pop()
      if (!userMsg) return

      const suggest = (aiMsg as any).experience_suggest
      try {
        await saveSuggestedExperience({
          user_question: userMsg.content,
          ai_answer: aiMsg.content,
          user_id: localStorage.getItem('zhiwei_user_id') || 'default',
          conv_id: convId,
          msg_id: messageId,
        })
        dispatch({
          type: 'SET_EXPERIENCE_SUGGEST',
          payload: { conversationId: convId, messageId, suggest: null },
        })
      } catch (err) {
        console.error('Save experience suggestion failed:', err)
      }
    },
    [],
  )

  const dismissExperienceSuggestionAction = useCallback(
    async (messageId: string) => {
      const convId = persistedRef.current.activeConversationId
      if (!convId) return
      try {
        await dismissExperienceSuggestion(convId)
      } catch (err) {
        console.error('Dismiss experience suggestion failed:', err)
      }
      dispatch({
        type: 'SET_EXPERIENCE_SUGGEST',
        payload: { conversationId: convId, messageId, suggest: null },
      })
    },
    [],
  )

  const sendFeedbackAction = useCallback(
    async (messageId: string, rating: 'up' | 'down') => {
      const convId = persistedRef.current.activeConversationId
      if (!convId) return

      dispatch({
        type: 'SET_MESSAGE_FEEDBACK',
        payload: { conversationId: convId, messageId, rating },
      })

      try {
        await sendFeedback(convId, messageId, rating)
      } catch (err) {
        console.error('Feedback failed:', err)
      }
    },
    [],
  )

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
    setView,
    addPendingFiles,
    removePendingFile,
    clearPendingFiles,
    clearUploadProgress,
    confirmUpload,
    login,
    logout,
    sendFeedback: sendFeedbackAction,
    saveExperienceSuggestion: saveExperienceSuggestionAction,
    dismissExperienceSuggestion: dismissExperienceSuggestionAction,
  }

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat() {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used within ChatProvider')
  return {
    messages: ctx.state.conversations.find((c) => c.id === ctx.state.activeConversationId)?.messages ?? [],
    conversations: ctx.state.conversations,
    isLoading: ctx.state.isLoading,
    activeConversationId: ctx.state.activeConversationId,
    selectedCategory: ctx.state.selectedCategory,
    currentTool: ctx.state.currentTool,
    uploadedFiles: ctx.state.uploadedFiles,
    appView: ctx.state.appView,
    pendingFiles: ctx.state.pendingFiles,
    uploadProgress: ctx.state.uploadProgress,
    isUploading: ctx.state.isUploading,
    loggedIn: ctx.state.loggedIn,
    role: ctx.state.role,
    sendChat: ctx.sendChat,
    newConversation: ctx.newConversation,
    switchConversation: ctx.switchConversation,
    removeConversation: ctx.removeConversation,
    setCategory: ctx.setCategory,
    uploadFile: ctx.uploadFile,
    removeUploadedFile: ctx.removeUploadedFile,
    setView: ctx.setView,
    addPendingFiles: ctx.addPendingFiles,
    removePendingFile: ctx.removePendingFile,
    clearPendingFiles: ctx.clearPendingFiles,
    clearUploadProgress: ctx.clearUploadProgress,
    confirmUpload: ctx.confirmUpload,
    login: ctx.login,
    logout: ctx.logout,
    sendFeedback: ctx.sendFeedback,
    saveExperienceSuggestion: ctx.saveExperienceSuggestion,
    dismissExperienceSuggestion: ctx.dismissExperienceSuggestion,
  }
}
