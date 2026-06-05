import { useState, useEffect, useRef, useCallback } from 'react'
import { Input } from 'antd'
import { Search, X } from 'lucide-react'
import { searchMessages, type SearchResult } from '../api/chat'

function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }
  return text.replace(/[&<>"']/g, c => map[c])
}

interface SearchModalProps {
  open: boolean
  onClose: () => void
  onSelectResult: (convId: string, msgId: string) => void
}

export default function SearchModal({ open, onClose, onSelectResult }: SearchModalProps) {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<any>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setKeyword('')
      setResults([])
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (open) {
      window.addEventListener('keydown', handleKey)
      return () => window.removeEventListener('keydown', handleKey)
    }
  }, [open, onClose])

  const doSearch = useCallback(async (kw: string) => {
    if (!kw.trim()) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      const userId = localStorage.getItem('zhiwei_user_id') || 'default'
      const data = await searchMessages(kw.trim(), userId)
      setResults(data.results || [])
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  function handleChange(val: string) {
    setKeyword(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 250)
  }

  function handleSelect(result: SearchResult) {
    onSelectResult(result.conversation_id, result.message_id)
    onClose()
  }

  if (!open) return null

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <Search size={18} strokeWidth={2} className="search-input-icon" />
          <Input
            ref={inputRef}
            value={keyword}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="搜索对话记录…"
            bordered={false}
            size="large"
            style={{ fontSize: 16, paddingLeft: 8 }}
          />
          <button className="search-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {keyword.trim() && (
          <div className="search-results">
            {searching ? (
              <div className="search-hint">搜索中…</div>
            ) : results.length === 0 ? (
              <div className="search-hint">未找到包含「{keyword}」的对话记录</div>
            ) : (
              <>
                <div className="search-count">{results.length} 条结果</div>
                <div className="search-result-list">
                  {results.map((r, i) => (
                    <div
                      key={`${r.conversation_id}-${r.message_id}-${i}`}
                      className="search-result-item"
                      onClick={() => handleSelect(r)}
                    >
                      <div className="search-result-header">
                        <span className="search-result-role">
                          {r.role === 'user' ? '👤' : '🤖'}
                        </span>
                        <span className="search-result-conv">{r.conversation_title}</span>
                      </div>
                      <div
                        className="search-result-excerpt"
                        dangerouslySetInnerHTML={{
                          __html: escapeHtml(r.excerpt).replace(
                            new RegExp(escapeHtml(r.keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
                            (m) => `<mark>${m}</mark>`,
                          ),
                        }}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
