# Traffic Audit Skill — 设计文档

> 状态：待用户审核
> 日期：2026-06-23
> 范围：独立工具，与知微项目无关

## 1. 概述

批量审计 HTTP 流量包中的敏感信息。

用户有一个 PostgreSQL 数据表，其中某个字段存储了 HTTP 流量包文件的地址（`.http` 后缀），通过 PHP 页面渲染显示请求的 header 和 body。body 可能为明文、base64 编码、hex 编码、gzip 压缩、URL 编码、字符编码错乱（如 GBK 被误读为 UTF-8），或完全不可读的二进制/加密数据。

目标：批量访问这些流量包 → 自动解码 → AI 判断 body 是否包含敏感信息 → 输出 JSON 结果。

**整套流程封装为一个 Claude Code Skill**，目录结构：

```
skills/traffic-audit/
├── skill.md              ← Skill 定义（Claude 执行的指令）
├── scripts/
│   └── fetch_decode.py   ← Python 脚本（DB 读取 + HTTP 请求 + 解码管道）
└── output/               ← 输出目录
    ├── decoded.json
    └── result.json
```

---

## 2. 架构

**Skill 执行流程：**

```
用户调用 skill
    │
    ▼
Claude 执行 fetch_decode.py   ← Python：PG 查询 → 遍历 URI → HTTP 访问 → 解码管道
    │                              ↓
    │                         output/decoded.json
    ▼
Claude 读 decoded.json        ← AI：逐条判断敏感信息
    │                              ↓
    ▼                         output/result.json
输出摘要给用户
```

**Python 脚本通过 psycopg2 直连 PostgreSQL，不做 MCP。** 这是一次性批量查询，直接连接更简单，无需多一层抽象。

| 工作 | Python 做 | AI (Claude) 做 |
|------|----------|---------------|
| 数据库连接、HTTP 请求 | ✅ | ❌ |
| 字符编码检测、Base64/Hex/Gzip 解码 | ✅ | ❌ |
| 敏感信息语义判断 | ❌ | ✅ |
| 输出格式化 | ✅ | ✅ |

---

## 3. 解码管道 (traffic_fetch_decode.py)

### 3.1 输入

PostgreSQL 数据库，通过 `psycopg2` 连接。表名和 URI 字段名由用户后续提供。

数据库中的 URI 字段，格式如：`http://internal-server/flow/12345.http`

访问后 PHP 渲染的 HTML 页面中包含 header 和 body 信息。脚本需从 HTML 中提取原始 body 字节。页面结构由用户后续提供样例。

- 数据库连接、并发控制、认证：不需要特殊处理（单线程依次请求，无需认证）
- 输出：写入 `skills/traffic-audit/output/` 目录

### 3.2 管道流程

```
raw_bytes
  │
  ▼
L0: HTTP 传输解压 ──→ gzip / deflate / brotli（magic bytes 检测）
  │
  ▼
L1: 字符编码检测 ──→ charset-normalizer → 可读直接返回
  │
  ▼
L2: 有限迭代解码 (最多3轮)
  │   每轮依次尝试：base64 → hex → url-decode → base32
  │   任一成功即进入下一轮，无变化则退出
  │
  ▼
L1': 解码后再试字符编码 → 可读则返回
  │
  ▼
不可读 → 标记为 unreadable
```

### 3.3 L0 — HTTP 传输解压

| Magic Bytes | 格式 |
|-------------|------|
| `1F 8B` | gzip |
| `78 9C`/`78 01`/`78 DA` | zlib/deflate |
| `CE B2 CF` | brotli (需 `pip install brotli`) |

### 3.4 L1 — 字符编码检测

使用 `charset-normalizer`（Mozilla 维护，C 扩展，比 chardet 更快更准）：

```python
from charset_normalizer import from_bytes

result = from_bytes(data).best()
if result:
    text = str(result)
    if printable_ratio(text) > 0.3:  # 可打印字符占比 > 30%
        return text
```

回退：强制尝试 GBK、GB2312、GB18030、Big5、Shift-JIS、EUC-JP。

### 3.5 L2 — 有限迭代解码

```python
DECODERS = [
    ("base64",     b64decode,    is_base64),
    ("hex",        unhexlify,    is_hex),
    ("url-decode", unquote,      is_urlencoded),
    ("base32",     b32decode,    is_base32),
]
```

迭代规则：
- 每轮对所有解码器按优先级尝试
- 任一解码器成功（changed=True）→ 进入下一轮
- 无变化 → 退出
- 最多 3 轮
- 每次解码前检查外观条件（正则匹配字符集），避免不必要的异常

外观条件：
- base64: `^[A-Za-z0-9+/=\s\n\r]+$`
- hex: 偶数长度 + `^[0-9a-fA-F\s]+$`
- urlencoded: 包含 `%` 且可 ASCII 解码
- base32: 长度为 8 的倍数 + `^[A-Z2-7=]+$`

### 3.6 结果状态

| status | 含义 | decoded_text |
|--------|------|-------------|
| `readable` | 成功解码为可读文本 | 解码后的完整文本 |
| `unreadable` | 无法解码，二进制/加密数据 | null |

---

## 4. Skill 层 (traffic-audit.md)

### 4.1 处理流程

1. 读取 `decoded.json`
2. 统计总数 / 可读数 / 不可读数
3. 对 `status="readable"` 的条目，逐条用 AI 判断 `decoded_text` 是否包含敏感信息
4. 输出 `result.json`

### 4.2 敏感信息判定规则（当前版本）

- body 中包含主机操作系统版本信息（如 Windows Server 2019、Ubuntu 22.04、CentOS 7、macOS 14.x 等）
- body 中包含主机名
- body 中包含内网 IP 地址（10.0.0.0/8、172.16.0.0/12、192.168.0.0/16）
- body 中包含系统环境变量、已安装软件列表、补丁版本等主机指纹信息

### 4.3 输出格式

```json
{
  "summary": {
    "total": 5000,
    "readable": 3200,
    "unreadable": 1800,
    "sensitive": 45,
    "clean": 3155
  },
  "findings": [
    {
      "id": "流量包ID",
      "url": "原始.http地址",
      "sensitive": true,
      "reason": "包含主机OS版本: Windows Server 2019 Datacenter",
      "evidence": "截取的敏感文本片段（不超过200字）"
    }
  ],
  "unreadable": [
    {
      "id": "流量包ID",
      "url": "原始.http地址",
      "hint": ""
    }
  ]
}
```

### 4.4 规则扩展

Skill 定义中预留 `{{$additional_rules}}` 占位符，后续追加规则只需编辑 markdown，不改代码。

---

## 5. 依赖

```bash
pip install charset-normalizer brotli psycopg2-binary
```

标准库即可满足：`base64`、`binascii`、`urllib.parse`、`gzip`、`zlib`、`json`、`re`。

---

## 6. 待确认问题

实现前需用户提供：

1. **表名和 URI 字段名**
2. **PG 连接方式**（连接字符串或环境变量）
3. **`.http` 页面 HTML 结构**（样例 HTML 或描述 body 所在位置）

已确认：
- 数据库：PostgreSQL，Python 直连（不用 MCP）
- 并发控制：不需要，单线程依次请求
- 认证：不需要
- 输出目录：`skills/traffic-audit/output/`

---

## 7. 范围边界

**不包含：**
- 对不可读数据的解密尝试（暴力破解密钥）
- 实时监控/定期扫描（本次为一次性批量分析）
- Web UI / 报告图表
- 数据库写入（只读，输出 JSON 文件）
- 加密 body 的密钥管理/解密（只检测加密特征，不解密）

**后续可扩展：**
- 追加敏感信息规则（通过 `$additional_rules`）
- 输出 Markdown 报告
- 定期扫描定时任务
- 不可读数据的 AES 解密（如果提供了密钥）
