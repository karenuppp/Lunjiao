/**
 * UserManagePage — 管理员用户管理页面
 *
 * Features:
 * - List all users with their account, role
 * - Form to add new user (account, password, role)
 * - Delete user
 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Table, Input, Select, message, Popconfirm, Modal, Button } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { listUsers, createUser, deleteUser, changeUserPassword } from '../api/chat'
import type { UserRecord } from '../api/chat'

export default function UserManagePage() {
  const navigate = useNavigate()

  const [users, setUsers] = useState<UserRecord[]>([])
  const [loading, setLoading] = useState(false)

  const [newAccount, setNewAccount] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState('user')
  const [submitting, setSubmitting] = useState(false)

  const [cpModalOpen, setCpModalOpen] = useState(false)
  const [cpUserId, setCpUserId] = useState<number | null>(null)
  const [cpNewPassword, setCpNewPassword] = useState('')
  const [cpSubmitting, setCpSubmitting] = useState(false)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listUsers()
      setUsers(data)
    } catch (err: any) {
      message.error(err.message || '加载用户列表失败')
      // If unauthorized, redirect to chat
      if (err.message?.includes('无权限')) {
        navigate('/chat', { replace: true })
      }
    } finally {
      setLoading(false)
    }
  }, [navigate])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handleCreateUser = async () => {
    if (!newAccount.trim()) {
      message.warning('请输入账号')
      return
    }
    if (!newPassword.trim()) {
      message.warning('请输入密码')
      return
    }

    setSubmitting(true)
    try {
      await createUser(newAccount.trim(), newPassword.trim(), newRole)
      message.success('用户创建成功')
      setNewAccount('')
      setNewPassword('')
      setNewRole('user')
      fetchUsers()
    } catch (err: any) {
      message.error(err.message || '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteUser = async (userId: number) => {
    try {
      await deleteUser(userId)
      message.success('用户已删除')
      fetchUsers()
    } catch (err: any) {
      message.error(err.message || '删除失败')
    }
  }

  const openChangePwdModal = (userId: number) => {
    setCpUserId(userId)
    setCpNewPassword('')
    setCpModalOpen(true)
  }

  const handleChangePassword = async () => {
    if (!cpNewPassword.trim()) {
      message.warning('请输入新密码')
      return
    }
    if (cpUserId === null) return

    setCpSubmitting(true)
    try {
      await changeUserPassword(cpUserId, cpNewPassword.trim())
      message.success('密码修改成功')
      setCpModalOpen(false)
    } catch (err: any) {
      message.error(err.message || '修改密码失败')
    } finally {
      setCpSubmitting(false)
    }
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 80 },
    { title: '账号', dataIndex: 'account', key: 'account' },
    { title: '角色', dataIndex: 'role', key: 'role', width: 100,
      render: (role: string) => (
        <span style={{
          color: role === 'admin' ? '#4F46E5' : '#6b7280',
          fontWeight: role === 'admin' ? 600 : 400,
        }}>
          {role === 'admin' ? '管理员' : '普通用户'}
        </span>
      ),
    },
    {
      title: '操作', key: 'action', width: 180,
      render: (_: any, record: UserRecord) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openChangePwdModal(record.id)}
          >
            改密
          </Button>
          <Popconfirm
            title="确认删除该用户？"
            description="删除后该用户将无法登录"
            onConfirm={() => handleDeleteUser(record.id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, padding: '32px', overflow: 'auto' }}>
        <div style={{
          background: '#fff', borderRadius: 12, padding: 24, marginBottom: 24,
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}>
          <h3 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 600, color: '#1a1b2e' }}>
            <PlusOutlined style={{ marginRight: 8 }} />
            新增用户
          </h3>

          <div style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 12,
            flexWrap: 'wrap',
          }}>
            <div style={{ flex: '1 1 200px', minWidth: 160 }}>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6, fontWeight: 500 }}>账号</div>
              <Input
                placeholder="输入账号"
                value={newAccount}
                onChange={(e) => setNewAccount(e.target.value)}
                size="middle"
              />
            </div>

            <div style={{ flex: '1 1 200px', minWidth: 160 }}>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6, fontWeight: 500 }}>密码</div>
              <Input.Password
                placeholder="输入密码"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                size="middle"
              />
            </div>

            <div style={{ flex: '0 1 140px', minWidth: 110 }}>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6, fontWeight: 500 }}>角色</div>
              <Select
                value={newRole}
                onChange={setNewRole}
                size="middle"
                style={{ width: '100%' }}
                options={[
                  { value: 'user', label: '普通用户' },
                  { value: 'admin', label: '管理员' },
                ]}
              />
            </div>

            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreateUser}
              loading={submitting}
              size="middle"
              style={{ flex: '0 0 auto' }}
            >
              添加
            </Button>
          </div>
        </div>

        <div style={{
          background: '#fff', borderRadius: 12, padding: 24,
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#1a1b2e' }}>
            用户列表（{users.length}）
          </h3>
          <Table
            columns={columns}
            dataSource={users}
            rowKey="id"
            loading={loading}
            pagination={false}
            size="middle"
          />
        </div>
      </div>

      {/* Change Password Modal */}
      <Modal
        title="修改密码"
        open={cpModalOpen}
        onCancel={() => setCpModalOpen(false)}
        onOk={handleChangePassword}
        confirmLoading={cpSubmitting}
        okText="确认修改"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8, fontWeight: 500 }}>新密码</div>
          <Input.Password
            placeholder="请输入新密码"
            value={cpNewPassword}
            onChange={(e) => setCpNewPassword(e.target.value)}
            size="middle"
          />
        </div>
      </Modal>
    </div>
  )
}
