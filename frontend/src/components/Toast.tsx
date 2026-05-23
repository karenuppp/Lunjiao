import React, { createContext, useContext, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, XCircle } from 'lucide-react'

interface ToastItem {
  id: number
  type: 'success' | 'error'
  message: string
}

interface ToastContextType {
  success: (msg: string) => void
  error: (msg: string) => void
}

const ToastContext = createContext<ToastContextType>({
  success: () => {},
  error: () => {},
})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const addToast = useCallback((type: 'success' | 'error', message: string) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, type, message }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }, [])

  const success = useCallback((msg: string) => addToast('success', msg), [addToast])
  const error = useCallback((msg: string) => addToast('error', msg), [addToast])

  const value = useMemo(() => ({ success, error }), [success, error])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="toast-container">
          {toasts.map(toast => (
            <div key={toast.id} className={`toast-item toast-${toast.type}`}>
              {toast.type === 'success'
                ? <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
                : <XCircle size={18} style={{ flexShrink: 0 }} />
              }
              <span>{toast.message}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}
