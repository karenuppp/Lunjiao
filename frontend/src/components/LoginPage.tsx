/**
 * LoginPage — 伦教包登录页面
 *
 * Design direction: "Refined Institutional Portal"
 * Deep navy full-screen background mirrors the sidebar, creating a sense of
 * entering a secure workspace. The centered white card provides a clear
 * visual anchor with the brand name as a refined typographic statement.
 *
 * New: login is handled through chatStore — onLogin receives account+password
 * and returns a Promise. Navigation is handled by the caller (App.tsx).
 */

import { useState } from 'react'
import type { UserInfo } from '../types/chat'
import './Login.css'

interface LoginPageProps {
  onLogin: (account: string, password: string) => Promise<UserInfo>
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
      // Navigation handled by caller (App.tsx) after successful login
    } catch (err: any) {
      setError(err.message || '登录失败，请检查账号和密码')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      {/* Subtle background pattern layer */}
      <div className="login-bg-pattern" />

      {/* Centered card */}
      <div className="login-card">
        {/* Brand mark */}
        <div className="login-brand">
          <span className="login-brand-icon">包</span>
          <h1 className="login-brand-name">伦教包</h1>
          <p className="login-brand-sub">伦教部门智能知识问答平台</p>
        </div>

        {/* Form */}
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
