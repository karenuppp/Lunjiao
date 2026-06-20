# 技能已装备 Popover — 设计规格

日期：2026-06-20

## 概述

将 AppHeader 中静态的"技能已装备" Tag 改为可 hover 展开的 Popover，展示所有已连接技能的关键词和描述，并提示用户如何触发技能。

## 现状

- `AppHeader.tsx:172` — antd `<Tag>` 显示 sandbox 状态（绿/红），无交互
- 右侧按钮（更新日志、使用说明、反馈、退出）与 Tag 不在同一水平线
- `GET /api/skills` 已存在，无认证限制，返回全部技能字段
- `frontend/src/api/chat.ts` 已有 `listSkills()` 和 `SkillRecord` 接口

## 交互设计

- **触发方式**：hover（鼠标悬停 Tag 上展开，移走收起）
- **无技能时**：Popover 内容显示"暂无已装备技能"
- **API 加载失败时**：Popover 内容显示"加载失败"，Tag 仍正常展示
- **sandbox 不可用时**：Tag 仍红色"技能未预备"，Popover 仍可展开查看技能列表

## Popover 内容布局

```
┌─────────────────────────────────────┐
│  已装备技能                          │  Popover title
├─────────────────────────────────────┤
│  🔑  公文格式                        │  skill.title
│      输出的Word文档自动按公文格式整理  │  skill.description
│                                     │
│  🔑  下一个技能…（如有）              │
│      描述…                          │
├─────────────────────────────────────┤
│  💡 在提问中使用对应关键词即可触发     │  灰色提示文字
│     技能，如"整理成公文格式"          │
└─────────────────────────────────────┘
```

## 数据流

```
AppHeader mount
  → listSkills() → GET /api/skills
  → setSkills(data)
  → 用户 hover Tag → Popover 展开
  → 遍历 skills 渲染
```

## 实现计划

### 1. `AppHeader.tsx`

- 引入 `Popover` from antd
- 新增 `skills` state 和 `skillsError` state，mount 时调 `listSkills()`
- catch 错误时设 `skillsError=true`，Popover 显示"加载失败"
- Tag 外层包 `<Popover>`，trigger="hover"
- Popover content 渲染技能列表 + 底部提示
- Tag 添加 `cursor: 'pointer'` 暗示可交互

### 2. 修复垂直对齐

Tag 与右侧按钮对齐不一致。方案：将 Tag 包在 `span` 中，设 `display: inline-flex; align-items: center; padding: 4px 0;`，使其中线与 `.help-btn-box`（padding: 4px 12px）对齐为同一基线。

### 3. `App.css`

新增少量样式：

```css
.skill-popover-content { max-width: 320px; }
.skill-item { padding: 8px 0; border-bottom: 1px solid #F3F4F6; }
.skill-item:last-child { border-bottom: none; }
.skill-title { font-weight: 600; color: #1F2937; font-size: 13px; margin-bottom: 2px; }
.skill-desc { color: #6B7280; font-size: 12px; }
.skill-empty { color: #9CA3AF; font-size: 13px; text-align: center; padding: 12px 0; }
.skill-hint { margin-top: 10px; padding-top: 8px; border-top: 1px solid #E5E7EB; color: #9CA3AF; font-size: 12px; line-height: 1.6; }
```

## 涉及文件

| 文件 | 改动类型 |
|------|----------|
| `frontend/src/components/AppHeader.tsx` | 修改 — 添加 Popover、skills state、useEffect |
| `frontend/src/App.css` | 修改 — 添加 popover 内容样式 |

## 验证要点

- [ ] hover Tag → Popover 弹出，显示技能列表
- [ ] 移走 → Popover 消失
- [ ] 无技能时显示"暂无已装备技能"
- [ ] sandbox 不可用时 Tag 仍红色，Popover 正常工作
- [ ] Tag 与右侧按钮水平对齐
- [ ] TypeScript 编译无错误
