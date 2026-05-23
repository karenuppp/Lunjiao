import { useState, useEffect } from 'react'
import type { UserInfo } from '../types/chat'
import './Login.css'

const BUBBLE_MESSAGES = [
  '知微知彰，洞见成长。',
  '交流使我进步！',
]

interface LoginPageProps {
  onLogin: (account: string, password: string) => Promise<UserInfo>
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [bubbleText, setBubbleText] = useState('')

  useEffect(() => {
    const pickNext = (current: string) => {
      const available = BUBBLE_MESSAGES.filter(m => m !== current)
      return available[Math.floor(Math.random() * available.length)]
    }

    const showTimer = setTimeout(() => {
      setBubbleText(pickNext(''))
    }, 800)

    const interval = setInterval(() => {
      setBubbleText(prev => pickNext(prev))
    }, 10000)

    return () => {
      clearTimeout(showTimer)
      clearInterval(interval)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!account.trim()) {
      setError('请输入账号')
      return
    }
    if (!password.trim()) {
      setError('请输入密码')
      return
    }

    setError('')
    setLoading(true)

    try {
      await onLogin(account.trim(), password.trim())
    } catch (err: any) {
      setError(err.message || '登录失败，请检查账号和密码')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-bg-pattern" />

      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo-wrap">
            <img className="login-brand-logo" src="/logo-circle.png" alt="知微" />
            {bubbleText && (
              <div className="login-logo-bubble" key={bubbleText}>{bubbleText}</div>
            )}
          </div>
          <h1 className="login-brand-name">知微</h1>
          <p className="login-brand-sub">一款会成长的AI助理</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <label className="login-label" htmlFor="login-account">
              账号
            </label>
            <input
              id="login-account"
              className="login-input"
              type="text"
              value={account}
              onChange={(e) => { setAccount(e.target.value); setError('') }}
              placeholder="输入您的账号"
              autoFocus
              autoComplete="username"
            />
          </div>

          <div className="login-field">
            <label className="login-label" htmlFor="login-password">
              密码
            </label>
            <input
              id="login-password"
              className="login-input"
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError('') }}
              placeholder="输入您的密码"
              autoComplete="current-password"
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button
            className={`login-btn ${loading ? 'login-btn--loading' : ''}`}
            type="submit"
            disabled={loading}
          >
            {loading ? (
              <span className="login-btn-spinner" />
            ) : (
              '登 录'
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
