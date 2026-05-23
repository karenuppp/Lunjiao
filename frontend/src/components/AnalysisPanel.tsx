import { useState } from 'react'
import {
  Typography,
  Tabs,
  Button,
  Space,
  Table,
  Select,
  Tooltip,
} from 'antd'
import {
  CloseOutlined,
  DownloadOutlined,
  FullscreenOutlined,
  ExportOutlined,
  BarChartOutlined,
  FileTextOutlined,
  TableOutlined,
} from '@ant-design/icons'

const { Text } = Typography

interface AnalysisPanelProps {
  onClose: () => void
}

const chartTypes = ['柱状图', '折线图', '饼图', '条形图']

const columns = [
  { title: '月份', dataIndex: 'month', key: 'month' },
  { title: '故障率', dataIndex: 'rate', key: 'rate' },
  { title: '环比变化', dataIndex: 'change', key: 'change' },
  { title: '设备数', dataIndex: 'count', key: 'count' },
]

const dataSource = [
  { key: '1', month: '1月', rate: '3.1%', change: '-', count: 42 },
  { key: '2', month: '2月', rate: '2.8%', change: '-0.3%', count: 38 },
  { key: '3', month: '3月', rate: '3.2%', change: '+0.4%', count: 45 },
]

export default function AnalysisPanel({ onClose }: AnalysisPanelProps) {
  const [chartType, setChartType] = useState('柱状图')
  const [activeTab, setActiveTab] = useState('chart')

  const tabItems = [
    {
      key: 'chart',
      label: (
        <span>
          <BarChartOutlined /> 当前图表
        </span>
      ),
      children: (
        <div style={{ padding: '4px 0' }}>
          <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
            <Select
              value={chartType}
              onChange={setChartType}
              options={chartTypes.map((t) => ({ value: t, label: t }))}
              size="small"
              style={{ width: 100 }}
            />
            <Space size={4}>
              <Tooltip title="全屏查看">
                <Button type="text" size="small" icon={<FullscreenOutlined />} />
              </Tooltip>
              <Tooltip title="下载图表">
                <Button type="text" size="small" icon={<DownloadOutlined />} />
              </Tooltip>
            </Space>
          </Space>

          {/* Chart visualization — ECharts integration pending */}
          <div
            style={{
              height: 220,
              background: 'linear-gradient(135deg, #E8F0FE, #D6E4FF)',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 12,
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <BarChartOutlined style={{ fontSize: 48, color: '#1E6FFF', opacity: 0.4 }} />
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {chartType} — 设备故障率趋势
              </Text>
            </div>
          </div>

          <div
            style={{
              padding: '8px 12px',
              background: '#f0f5ff',
              borderRadius: 8,
              fontSize: 12,
            }}
          >
            <Text strong style={{ color: '#1E6FFF', fontSize: 12 }}>分析摘要</Text>
            <div style={{ marginTop: 4 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                3月故障率 3.2%，环比上升 0.4 个百分点。建议关注生产线 A 传送带电机维护。
              </Text>
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'report',
      label: (
        <span>
          <FileTextOutlined /> 当前报告
        </span>
      ),
      children: (
        <div style={{ padding: '4px 0' }}>
          <div
            style={{
              padding: 12,
              background: '#f9fafb',
              borderRadius: 8,
              marginBottom: 12,
            }}
          >
            <Text strong style={{ fontSize: 14 }}>设备故障率月度分析报告</Text>
            <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.8, color: '#374151' }}>
              <p><strong>报告期间：</strong>2026年3月</p>
              <p><strong>核心结论：</strong></p>
              <p>本月设备故障率为 3.2%，较上月上升 0.4 个百分点。生产线 A 的传送带电机连续三个月出现故障，建议列入重点检修计划。</p>
              <p><strong>建议措施：</strong></p>
              <ul>
                <li>生产线 A 传送带电机 — 建议本周安排检修</li>
                <li>包装机传感器 — 已安排下周校准</li>
                <li>建立设备健康度评分体系</li>
              </ul>
            </div>
          </div>
          <Button block icon={<DownloadOutlined />}>
            导出 PDF 报告
          </Button>
        </div>
      ),
    },
    {
      key: 'data',
      label: (
        <span>
          <TableOutlined /> 数据预览
        </span>
      ),
      children: (
        <div style={{ padding: '4px 0' }}>
          <Table
            dataSource={dataSource}
            columns={columns}
            size="small"
            pagination={false}
            bordered
          />
          <Button
            block
            icon={<ExportOutlined />}
            style={{ marginTop: 12 }}
          >
            导出 CSV
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid #e5e7eb',
          flexShrink: 0,
        }}
      >
        <Text strong style={{ fontSize: 14 }}>
          分析控制台
        </Text>
        <Button type="text" icon={<CloseOutlined />} onClick={onClose} size="small" />
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 12px' }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={tabItems}
          size="small"
          style={{ marginTop: 0 }}
        />
      </div>

      <div
        style={{
          padding: '12px',
          borderTop: '1px solid #e5e7eb',
          flexShrink: 0,
        }}
      >
        <Button
          type="primary"
          block
          icon={<ExportOutlined />}
          style={{ height: 40, borderRadius: 8 }}
        >
          导出全部
        </Button>
      </div>
    </div>
  )
}
