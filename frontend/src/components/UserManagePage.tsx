import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Table, Input, Select, message, Modal, Button, Radio, Checkbox, Spin } from 'antd'
import { PlusOutlined, DeleteOutlined, EditOutlined, SafetyOutlined } from '@ant-design/icons'
import {
  listUsers,
  createUser,
  deleteUser,
  changeUserPassword,
  listDbConnections,
  getUserQueryPermission,
  setUserQueryPermission,
} from '../api/chat'
import type { UserRecord, DbConnectionRecord } from '../api/chat'

/* ── knowledge base scope labels ── */
const KB_SCOPE_LABELS: Record<string, string> = {
  public: '公共知识库',
  personal: '个人知识库',
  none: '不授权',
}

export default function UserManagePage() {
  const navigate = useNavigate()

  /* ── user list ── */
  const [users, setUsers] = useState<UserRecord[]>([])
  const [loading, setLoading] = useState(false)

  /* ── new-user form ── */
  const [newAccount, setNewAccount] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState('user')
  const [submitting, setSubmitting] = useState(false)

  /* ── change-password modal ── */
  const [cpModalOpen, setCpModalOpen] = useState(false)
  const [cpUserId, setCpUserId] = useState<number | null>(null)
  const [cpNewPassword, setCpNewPassword] = useState('')
  const [cpSubmitting, setCpSubmitting] = useState(false)

  /* ── delete-user modal ── */
  const [delModalOpen, setDelModalOpen] = useState(false)
  const [delUserId, setDelUserId] = useState<number | null>(null)
  const [delSubmitting, setDelSubmitting] = useState(false)

  /* ── query-permission modal ── */
  const [permModalOpen, setPermModalOpen] = useState(false)
  const [permUserId, setPermUserId] = useState<number | null>(null)
  const [permKbScope, setPermKbScope] = useState('personal')
  const [permDbScope, setPermDbScope] = useState<number[]>([])
  const [permSubmitting, setPermSubmitting] = useState(false)
  const [dbConnections, setDbConnections] = useState<DbConnectionRecord[]>([])
  const [dbLoading, setDbLoading] = useState(false)

  /* ── fetch users ── */
  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listUsers()
      setUsers(data)
    } catch (err: any) {
      message.error(err.message || '加载用户列表失败')
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

  /* ── create user ── */
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

  /* ── delete user ── */
  const openDeleteModal = (userId: number) => {
    setDelUserId(userId)
    setDelModalOpen(true)
  }

  const handleDeleteUser = async () => {
    if (delUserId === null) return
    setDelSubmitting(true)
    try {
      await deleteUser(delUserId)
      message.success('用户已删除')
      setDelModalOpen(false)
      fetchUsers()
    } catch (err: any) {
      message.error(err.message || '删除失败')
    } finally {
      setDelSubmitting(false)
    }
  }

  /* ── change password ── */
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

  /* ── query permission ── */
  const openPermModal = async (userId: number) => {
    setPermUserId(userId)
    setPermModalOpen(true)
    setPermKbScope('personal')
    setPermDbScope([])
    setDbLoading(true)

    // Fetch current permission + active DB connections in parallel
    try {
      const [perm, conns] = await Promise.all([
        getUserQueryPermission(userId),
        listDbConnections(),
      ])
      setPermKbScope(perm.kb_scope || 'personal')
      setPermDbScope(perm.db_scope || [])
      setDbConnections(conns)
    } catch (err: any) {
      message.error(err.message || '加载权限信息失败')
    } finally {
      setDbLoading(false)
    }
  }

  const handleSavePermission = async () => {
    if (permUserId === null) return
    setPermSubmitting(true)
    try {
      await setUserQueryPermission(permUserId, {
        kb_scope: permKbScope,
        db_scope: permDbScope.length > 0 ? permDbScope : null,
      })
      message.success('权限保存成功')
      setPermModalOpen(false)
      fetchUsers() // refresh list to show updated scope
    } catch (err: any) {
      message.error(err.message || '保存权限失败')
    } finally {
      setPermSubmitting(false)
    }
  }

  /* ── columns ── */
  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 80 },
    { title: '账号', dataIndex: 'account', key: 'account', width: 140 },
    {
      title: '角色', dataIndex: 'role', key: 'role', width: 100,
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
      title: '知识库范围', dataIndex: 'kb_scope', key: 'kb_scope', width: 130,
      render: (scope: string) => KB_SCOPE_LABELS[scope] || scope,
    },
    {
      title: '操作', key: 'action', width: 260,
      render: (_: any, record: UserRecord) => (
        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button
            type="link"
            size="small"
            icon={<SafetyOutlined />}
            onClick={() => openPermModal(record.id)}
          >
            查询权限
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openChangePwdModal(record.id)}
          >
            修改密码
          </Button>
          <Button
            type="link"
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => openDeleteModal(record.id)}
          >
            删除用户
          </Button>
        </div>
      ),
    },
  ]

  /* ── active DB connections for permission modal ── */
  const activeDbConns = dbConnections.filter(c => c.status === 'connected')

  return (
    <div style={{ height: '100%', padding: '32px', overflow: 'auto' }}>
      {/* ── New user card ── */}
      <div className="page-card">
        <h3 className="page-card-heading">
          <PlusOutlined style={{ marginRight: 8 }} />
          新增用户
        </h3>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
          flexWrap: 'wrap',
          marginBottom: 24,
          paddingBottom: 24,
          borderBottom: '1px solid #f0f0f0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#6b7280', fontWeight: 500, whiteSpace: 'nowrap' }}>账号</span>
            <Input
              placeholder="输入账号"
              value={newAccount}
              onChange={(e) => setNewAccount(e.target.value)}
              size="middle"
              style={{ width: 180 }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#6b7280', fontWeight: 500, whiteSpace: 'nowrap' }}>密码</span>
            <Input.Password
              placeholder="输入密码"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              size="middle"
              style={{ width: 180 }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#6b7280', fontWeight: 500, whiteSpace: 'nowrap' }}>角色</span>
            <Select
              value={newRole}
              onChange={setNewRole}
              size="middle"
              style={{ width: 130 }}
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
          >
            添加
          </Button>
        </div>

        <h3 className="page-card-heading" style={{ marginBottom: 16 }}>
          用户列表（{users.length}）
        </h3>
        <Table
          columns={columns}
          dataSource={users}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="small"
        />
      </div>

      {/* ── Change password modal ── */}
      <Modal
        title="修改密码"
        open={cpModalOpen}
        onCancel={() => setCpModalOpen(false)}
        onOk={handleChangePassword}
        confirmLoading={cpSubmitting}
        okText="确认修改"
        cancelText="取消"
      >
        <div style={{ margin: '12px 0' }}>
          <div style={{ marginBottom: 8, color: '#6b7280', fontSize: 13 }}>
            账号：{users.find(u => u.id === cpUserId)?.account ?? ''}
          </div>
          <Input.Password
            placeholder="输入新密码"
            value={cpNewPassword}
            onChange={(e) => setCpNewPassword(e.target.value)}
            size="middle"
          />
        </div>
      </Modal>

      {/* ── Delete user modal ── */}
      <Modal
        title="删除用户"
        open={delModalOpen}
        onCancel={() => setDelModalOpen(false)}
        onOk={handleDeleteUser}
        confirmLoading={delSubmitting}
        okText="确认"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <div style={{ margin: '12px 0', fontSize: 14 }}>
          是否确认删除该用户？
          <div style={{ marginTop: 8, color: '#6b7280', fontSize: 13 }}>
            账号：{users.find(u => u.id === delUserId)?.account ?? ''}
          </div>
          <div style={{ marginTop: 4, color: '#ef4444', fontSize: 12 }}>
            删除后该用户将无法登录
          </div>
        </div>
      </Modal>

      {/* ── Query permission modal ── */}
      <Modal
        title="查询权限"
        open={permModalOpen}
        onCancel={() => setPermModalOpen(false)}
        onOk={handleSavePermission}
        confirmLoading={permSubmitting}
        okText="确认"
        cancelText="取消"
        width={520}
      >
        <Spin spinning={dbLoading}>
          <div style={{ margin: '12px 0' }}>
            {/* Account info */}
            <div style={{ marginBottom: 16, color: '#6b7280', fontSize: 13 }}>
              账号：{users.find(u => u.id === permUserId)?.account ?? ''}
            </div>

            {/* KB scope */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 14 }}>知识库查询范围</div>
              <Radio.Group
                value={permKbScope}
                onChange={(e) => setPermKbScope(e.target.value)}
                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                <Radio value="public">公共知识库</Radio>
                <Radio value="personal" disabled>个人知识库</Radio>
                <Radio value="none">不授权</Radio>
              </Radio.Group>
            </div>

            {/* DB scope */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 14 }}>数据库查询范围</div>
              {activeDbConns.length === 0 ? (
                <div style={{ color: '#9ca3af', fontSize: 13 }}>
                  暂无活跃的数据库连接
                </div>
              ) : (
                <Checkbox.Group
                  value={permDbScope}
                  onChange={(values) => setPermDbScope(values as number[])}
                  style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                >
                  {activeDbConns.map((c) => (
                    <Checkbox key={c.id} value={c.id}>
                      {c.name}
                      <span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 6 }}>
                        ({c.host}:{c.port}/{c.table_name})
                      </span>
                    </Checkbox>
                  ))}
                </Checkbox.Group>
              )}
            </div>
          </div>
        </Spin>
      </Modal>
    </div>
  )
}
