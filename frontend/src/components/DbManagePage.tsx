import { useState, useEffect, useCallback } from 'react'
import { Table, Button, Modal, Input, InputNumber, Tag, Space, message, Popconfirm } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  PlusOutlined,
  DatabaseOutlined,
  LinkOutlined,
  DisconnectOutlined,
  DeleteOutlined,
} from '@ant-design/icons'
import {
  listDbConnections,
  createDbConnection,
  testDbConnection,
  disconnectDbConnection,
  connectDbConnection,
  deleteDbConnection,
  type DbConnectionRecord,
  type DbFieldInfo,
  type TestConnectionResult,
} from '../api/chat'

export default function DbManagePage() {
  const [connections, setConnections] = useState<DbConnectionRecord[]>([])
  const [loading, setLoading] = useState(false)

  const fetchConnections = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listDbConnections()
      setConnections(data)
    } catch (err: any) {
      message.error('加载连接列表失败: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConnections()
  }, [fetchConnections])

  const [modalOpen, setModalOpen] = useState(false)
  const [connName, setConnName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState<number | null>(3306)
  const [dbName, setDbName] = useState('')
  const [tableName, setTableName] = useState('')
  const [dbUser, setDbUser] = useState('')
  const [dbPassword, setDbPassword] = useState('')

  const [testing, setTesting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null)

  const resetModal = () => {
    setConnName('')
    setHost('')
    setPort(3306)
    setDbName('')
    setTableName('')
    setDbUser('')
    setDbPassword('')
    setTestResult(null)
  }

  const handleTest = async () => {
    if (!host || !port) {
      message.warning('请填写数据库地址和端口')
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testDbConnection({
        name: connName || '临时连接',
        host,
        port: port!,
        db_name: dbName,
        table_name: tableName,
        db_user: dbUser,
        db_password: dbPassword,
      })
      setTestResult(result)
      if (result.success) {
        message.success('连接成功！')
      } else {
        message.error(result.message)
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message, fields: [] })
      message.error('测试连接失败: ' + err.message)
    } finally {
      setTesting(false)
    }
  }

  const handleConfirmAdd = async () => {
    if (!connName || !host || !port || !tableName || !dbUser) {
      message.warning('请填写所有必填字段')
      return
    }
    if (!testResult || !testResult.success) {
      message.warning('请先点击「测试连接」并确保成功')
      return
    }
    setSubmitting(true)
    try {
      await createDbConnection({
        name: connName,
        host,
        port: port!,
        db_name: dbName,
        table_name: tableName,
        db_user: dbUser,
        db_password: dbPassword,
      })
      message.success('数据库连接已添加')
      setModalOpen(false)
      resetModal()
      fetchConnections()
    } catch (err: any) {
      message.error('添加失败: ' + err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDisconnect = async (id: number) => {
    try {
      await disconnectDbConnection(id)
      message.info('已断开连接')
      fetchConnections()
    } catch (err: any) {
      message.error('断开失败: ' + err.message)
    }
  }

  const handleConnect = async (id: number) => {
    try {
      const result = await connectDbConnection(id)
      if (result.status === 'connected') {
        message.success('连接成功')
      } else {
        message.error(result.message)
      }
      fetchConnections()
    } catch (err: any) {
      message.error('连接失败: ' + err.message)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteDbConnection(id)
      message.success('已删除')
      fetchConnections()
    } catch (err: any) {
      message.error('删除失败: ' + err.message)
    }
  }

  const columns: ColumnsType<DbConnectionRecord> = [
    { title: '连接名称', dataIndex: 'name', key: 'name', width: 140 },
    { title: '数据库地址', dataIndex: 'host', key: 'host', width: 150 },
    { title: '端口', dataIndex: 'port', key: 'port', width: 70 },
    { title: '表名', dataIndex: 'table_name', key: 'table_name', width: 140 },
    {
      title: '连接状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (val: string) =>
        val === 'connected' ? <Tag color="green">正常</Tag> : <Tag color="default">未连接</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 170,
      render: (_, record) => (
        <Space size={4}>
          {record.status === 'connected' ? (
            <Button
              size="small"
              icon={<DisconnectOutlined />}
              onClick={() => handleDisconnect(record.id)}
            >
              断开
            </Button>
          ) : (
            <Button
              size="small"
              icon={<LinkOutlined />}
              onClick={() => handleConnect(record.id)}
            >
              连接
            </Button>
          )}
          <Popconfirm title="确定删除该连接？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const fieldColumns: ColumnsType<DbFieldInfo> = [
    { title: '字段名', dataIndex: 'name', key: 'name' },
    { title: '类型', dataIndex: 'type', key: 'type' },
  ]

  return (
    <div style={{ height: '100%', padding: '32px', overflow: 'auto' }}>
      <div className="page-card">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
          }}
        >
          <h3 className="page-card-heading" style={{ margin: 0 }}>
            连接列表（{connections.length}）
          </h3>
          <Button
            type="primary"
            size="middle"
            icon={<PlusOutlined />}
            onClick={() => {
              resetModal()
              setModalOpen(true)
            }}
          >
            数据库连接
          </Button>
        </div>

        <Table<DbConnectionRecord>
          dataSource={connections}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="small"
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
            showTotal: (total, range) => `${range[0]}-${range[1]} / 共 ${total} 个连接`,
            size: 'small',
          }}
          locale={{ emptyText: '暂无数据库连接，点击上方按钮添加' }}
        />
      </div>

      <Modal
        title={
          <span>
            <DatabaseOutlined style={{ marginRight: 8 }} />
            新增数据库连接
          </span>
        }
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false)
          resetModal()
        }}
        footer={null}
        width={600}
        destroyOnClose
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>连接名称</div>
              <Input
                placeholder="例如：生产数据库"
                value={connName}
                onChange={(e) => setConnName(e.target.value)}
                size="middle"
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>数据库地址</div>
              <Input
                placeholder="例如：192.168.1.100"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                size="middle"
              />
            </div>
            <div style={{ width: 120 }}>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>端口</div>
              <InputNumber
                placeholder="3306"
                value={port}
                onChange={(v) => setPort(v)}
                size="middle"
                style={{ width: '100%' }}
                min={1}
                max={65535}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>用户</div>
              <Input
                placeholder="数据库用户名"
                value={dbUser}
                onChange={(e) => setDbUser(e.target.value)}
                size="middle"
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>密码</div>
              <Input.Password
                placeholder="数据库密码"
                value={dbPassword}
                onChange={(e) => setDbPassword(e.target.value)}
                size="middle"
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>数据库名</div>
              <Input
                placeholder="例如：mydb（可选）"
                value={dbName}
                onChange={(e) => setDbName(e.target.value)}
                size="middle"
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>表名</div>
              <Input
                placeholder="例如：users"
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                size="middle"
              />
            </div>
          </div>

          {testResult?.success && testResult.fields.length > 0 && (
            <div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
                获取到 {testResult.fields.length} 个字段：
              </div>
              <Table<DbFieldInfo>
                dataSource={testResult.fields}
                columns={fieldColumns}
                rowKey="name"
                size="small"
                pagination={false}
                style={{ marginBottom: 0 }}
              />
            </div>
          )}

          {(testResult?.success || (testResult && !testResult.success)) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {testResult?.success && (
                <span style={{ color: '#16a34a', fontWeight: 600, fontSize: 14 }}>
                  连接成功！
                </span>
              )}
              {testResult && !testResult.success && (
                <span style={{ color: '#dc2626', fontSize: 13 }}>{testResult.message}</span>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
            <Button onClick={handleTest} loading={testing} size="middle">
              测试连接
            </Button>
            <Button
              size="middle"
              onClick={() => {
                setModalOpen(false)
                resetModal()
              }}
            >
              取消
            </Button>
            <Button type="primary" size="middle" onClick={handleConfirmAdd} loading={submitting}>
              确认添加
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
