import { useState, useEffect } from 'react'
import {
  Modal,
  List,
  Tag,
  Button,
  Typography,
  Spin,
  Space,
  Empty,
} from 'antd'
import { DatabaseOutlined, FileOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'

const { Text } = Typography

interface DataSource {
  id: string
  name: string
  type: 'database' | 'upload'
  status: 'connected' | 'disconnected'
  description?: string
}

async function fetchDataSourceList(): Promise<DataSource[]> {
  try {
    const res = await fetch('/api/data-sources/')
    if (!res.ok) return []
    const data: DataSource[] = await res.json()
    return data
  } catch {
    return [
      { id: 'db-hr', name: '人事数据库', type: 'database', status: 'connected', description: '员工信息、组织结构、考勤数据' },
      { id: 'db-equipment', name: '设备数据库', type: 'database', status: 'connected', description: '设备台账、维修记录、运行状态' },
      { id: 'db-finance', name: '财务数据库', type: 'database', status: 'disconnected', description: '预算、报销、合同台账' },
    ]
  }
}

const _defaultSources: DataSource[] = [
  { id: 'db-hr', name: '人事数据库', type: 'database', status: 'connected', description: '员工信息、组织结构、考勤数据' },
  { id: 'db-equipment', name: '设备数据库', type: 'database', status: 'connected', description: '设备台账、维修记录、运行状态' },
  { id: 'db-finance', name: '财务数据库', type: 'database', status: 'disconnected', description: '预算、报销、合同台账' },
  { id: 'upload-001', name: '5月设备日志.xlsx', type: 'upload', status: 'connected', description: '上传于 2026-04-27' },
]

interface DataSourceModalProps {
  open: boolean
  onClose: () => void
}

export default function DataSourceModal({ open, onClose }: DataSourceModalProps) {
  const [sources, setSources] = useState<DataSource[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setLoading(true)
      fetchDataSourceList().then((data) => {
        setSources(data.length > 0 ? data : _defaultSources)
        setLoading(false)
      })
    }
  }, [open])

  return (
    <Modal
      title={
        <Space>
          <DatabaseOutlined />
          <span>数据源管理</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Button icon={<ReloadOutlined />}>刷新状态</Button>
          <Button type="primary" icon={<PlusOutlined />}>
            添加数据源
          </Button>
        </Space>
      }
      width={560}
    >
      <Spin spinning={loading}>
        <List
          dataSource={sources}
          renderItem={(item) => (
            <List.Item
              style={{
                padding: '12px 0',
                borderBottom: '1px solid #f0f0f0',
              }}
            >
              <List.Item.Meta
                avatar={
                  item.type === 'database' ? (
                    <DatabaseOutlined style={{ fontSize: 20, color: '#1E6FFF' }} />
                  ) : (
                    <FileOutlined style={{ fontSize: 20, color: '#f39c12' }} />
                  )
                }
                title={
                  <Space>
                    <Text strong>{item.name}</Text>
                    <Tag
                      color={item.status === 'connected' ? 'success' : 'default'}
                      style={{ borderRadius: 4, fontSize: 11, lineHeight: '18px' }}
                    >
                      {item.status === 'connected' ? '已连接' : '未连接'}
                    </Tag>
                    <Tag
                      color={item.type === 'database' ? 'blue' : 'orange'}
                      style={{ borderRadius: 4, fontSize: 11, lineHeight: '18px' }}
                    >
                      {item.type === 'database' ? '数据库' : '上传文件'}
                    </Tag>
                  </Space>
                }
                description={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {item.description}
                  </Text>
                }
              />
              <Space>
                <Button type="link" size="small">
                  {item.status === 'connected' ? '断开' : '连接'}
                </Button>
                <Button type="link" size="small" danger>
                  移除
                </Button>
              </Space>
            </List.Item>
          )}
          locale={{
            emptyText: <Empty description="暂无数据源，点击上方按钮添加" />,
          }}
        />
      </Spin>
    </Modal>
  )
}
