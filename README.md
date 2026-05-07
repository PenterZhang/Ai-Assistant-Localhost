# 甲核 (JiaHe) — 本地 AI 助手平台

## 项目概述

甲核是一个运行在 macOS 上的本地 AI 助手应用，支持多模型对话、iMessage 自动回复、联网搜索等功能。它既可以通过浏览器访问，也可以作为独立的 Electron 桌面应用运行。

## 技术架构

```
┌─────────────────────────────────────────────────┐
│                  甲核 (JiaHe)                     │
├─────────────────────────────────────────────────┤
│                                                   │
│  ┌──────────────┐    ┌─────────────────────────┐ │
│  │   前端 UI     │    │     Electron 桌面壳      │ │
│  │  React + Vite │    │  Electron + TypeScript  │ │
│  │  localhost:5173│    │  打包为 macOS .app      │ │
│  └──────┬───────┘    └──────────┬──────────────┘ │
│         │ http proxy            │ 加载页面        │
│  ┌──────┴───────────────────────┴──────────────┐ │
│  │              Fastify API 服务                 │ │
│  │           localhost:18789                     │ │
│  └──┬─────┬──────┬──────┬──────┬───────────────┘ │
│     │     │      │      │      │                  │
│  ┌──┴──┐┌─┴───┐┌─┴──┐┌─┴───┐┌─┴────────┐       │
│  │sql.js││Ollama││MiMo││Tavily││iMessage  │       │
│  │SQLite││本地  ││云端 ││搜索  ││chat.db   │       │
│  └─────┘└─────┘└────┘└─────┘└──────────┘       │
│                                                   │
└─────────────────────────────────────────────────┘
```

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端框架 | React 19 + TypeScript | 组件化 UI |
| 构建工具 | Vite 6 | 开发热更新 + 生产构建 |
| 桌面壳 | Electron 33 | 打包为 macOS 原生应用 |
| 后端框架 | Fastify 5 | 高性能 HTTP 服务 |
| 数据库 | sql.js (SQLite) | 浏览器兼容的 SQLite |
| AI 本地 | Ollama + Qwen 2.5 | 本地运行大模型 |
| AI 云端 | MiMo API | 小米云端模型 |
| 联网搜索 | Tavily API | 结构化网页搜索 |
| iMessage | macOS chat.db + osascript | 读写 iMessage |

## 目录结构

```
Ai-Assistant-Localhost/
├── config.json                 # 全局配置（模型、端口、iMessage、Tavily Key）
├── package.json                # 依赖与脚本（名称：jiahe）
├── index.html                  # Vite 入口 HTML
├── vite.config.ts              # Vite 配置 + API 代理
├── tsconfig.json               # 前端 TypeScript 配置
├── tsconfig.node.json          # 后端 TypeScript 配置
│
├── server/                     # 后端
│   ├── index.ts                # Fastify 主文件（路由、数据库、AI 调用、轮询、Sleep）
│   ├── imessage.ts             # iMessage 模块（读 chat.db、发送、诊断）
│   └── search.ts               # Tavily 联网搜索模块
│
├── electron/                   # Electron
│   ├── main.ts                 # Electron 主进程（窗口、Dock 图标、启动 Server）
│   └── preload.ts              # 预加载脚本
│
├── src/                        # 前端
│   ├── main.tsx                # React 入口
│   ├── App.tsx                 # 根组件（路由、全局状态）
│   ├── App.css                 # 全局样式（深色主题、毛玻璃、动画）
│   ├── api.ts                  # API 封装（fetch wrapper）
│   ├── types.ts                # TypeScript 类型定义
│   │
│   ├── components/
│   │   ├── Sidebar.tsx         # 侧边栏（会话列表、联系人、健康检测、设置入口）
│   │   ├── ChatArea.tsx        # 聊天区（消息列表 + 输入栏）
│   │   ├── MessageBubble.tsx   # 消息气泡（Markdown 渲染、代码高亮）
│   │   ├── CodeBlock.tsx       # 代码块（语法高亮 + 复制按钮）
│   │   ├── InputBar.tsx        # 输入栏（文本输入 + 🌐 搜索开关）
│   │   ├── AddContactModal.tsx # 添加 iMessage 联系人弹窗
│   │   ├── SetupWizard.tsx     # 首次启动引导页（选模型、配 API Key）
│   │   └── Settings.tsx        # 设置面板（模型管理、提示词、iMessage、Tavily）
│   │
│   ├── hooks/
│   │   ├── useSessions.ts      # 会话管理 Hook
│   │   ├── useChat.ts          # 聊天 Hook（SSE 流式接收）
│   │   ├── useIMessage.ts      # iMessage 联系人 Hook
│   │   └── useHealth.ts        # 健康检测 Hook
│   │
│   └── assets/
│       ├── favicon.ico         # 浏览器标签图标
│       └── logo.jpg            # 应用图标（Dock、窗口、DMG）
│
├── dist/                       # 构建输出
│   ├── renderer/               # Vite 构建的前端静态文件
│   └── node/                   # TypeScript 编译的后端代码
│
└── dist-build/                 # Electron Builder 打包输出
    └── mac-arm64/
        └── 甲核.app            # macOS 应用
```

## 核心功能

### 1. 多模型对话

```
用户输入 → 选择模型 → 构建上下文（system prompt + 历史消息）
  → 流式调用 AI API → SSE 实时推送到前端 → 逐字显示
```

支持的模型：

| 模型 | 类型 | 说明 |
|------|------|------|
| Qwen 2.5 (7B/3B) | 本地 | Ollama 运行，数据不出设备 |
| MiMo | 云端 | 小米 AI 模型，需 API Key |
| 自定义模型 | 本地/云端 | 用户通过设置面板添加 |

模型切换逻辑：
- Ollama 模型 → 走 `/api/chat` 接口（OpenAI 兼容格式）
- 非 Ollama → 走 OpenAI 兼容的 `/v1/chat/completions` 接口
- 自动根据 `base_url` 是否包含 `11434` 判断

### 2. iMessage 自动回复

```
macOS Messages.app
  ↓ 写入
~/Library/Messages/chat.db (SQLite)
  ↓ 轮询读取（sqlite3 CLI，3秒一次）
Fastify 后端
  ↓ 匹配联系人
  ↓ 调用 AI 生成回复
  ↓ osascript 发送 iMessage
对方收到回复
```

关键实现细节：
- **读取**：用 macOS 自带的 `sqlite3` 命令行读取 `chat.db`，避免 WAL 锁问题
- **发送**：通过 `osascript` 调用 Messages.app AppleScript API
- **权限**：需要完全磁盘访问 + 辅助功能权限
- **轮询**：`setTimeout` 递归方式，带心跳日志，错误不会中断轮询
- **冷却**：防止同一联系人短时间内重复触发（默认 5 秒）
- **触发模式**：`always`（所有消息触发）或 `prefix:/ai`（仅 `/ai` 前缀触发）
- **自触发**：用户自己发 `/ai xxx` 给联系人，AI 生成回复并发送

### 3. 联网搜索

```
用户点击 🌐 → 输入问题 → 发送
  ↓
Tavily API 搜索
  ↓
搜索结果注入 system prompt
  ↓
AI 基于搜索结果回答
  ↓
回答末尾标注来源链接
```

使用 Tavily API（结构化 JSON 返回，无需解析 HTML）。

### 4. 设置面板

```
⚙️ 设置
├── 模型管理
│   ├── 查看已配置模型
│   ├── 测试模型连接
│   ├── 设为默认模型
│   ├── 删除模型
│   └── 手动添加模型（自定义 API 地址、Key、参数）
├── 系统提示词
│   └── 编辑全局 system prompt
├── iMessage
│   ├── 启用/禁用
│   ├── 轮询间隔
│   └── 回复冷却时间
└── 搜索
    ├── 配置 Tavily API Key
    └── 测试连接
```

### 5. 首次启动引导

```
首次打开 → 检测环境
  ↓
已有 Ollama + 模型？→ 直接进入
已有 MiMo API Key？→ 直接进入
都没有？→ 显示引导页
  ├── ☁️ 云端模型 → 填 API Key → 完成
  └── 🏠 本地模型
      ├── 未安装 Ollama → 提示下载链接
      └── 已安装 → 选择模型 → 自动拉取 → 完成
```

### 6. 其他功能

- **睡眠阻止**：`caffeinate` 命令阻止系统休眠（长时间运行 AI 任务时使用）
- **健康检测**：实时检测 Ollama、MiMo、iMessage 的连接状态
- **会话持久化**：所有对话存储在 `~/.ai-assistant/chat.db`（sql.js）
- **Markdown 渲染**：支持代码高亮、表格、列表等
- **流式输出**：SSE 实时推送，逐字显示 AI 回复
- **自动标题**：第一条消息的回复自动作为会话标题

## 数据存储

```
~/.ai-assistant/
├── chat.db          # 会话 + 消息 + 联系人（sql.js 格式）
└── server.log       # 服务日志（可选）

~/Library/Messages/chat.db  # macOS iMessage 数据库（只读）

./config.json                # 全局配置（模型、端口、API Key）
```

数据库表结构：

```sql
sessions (会话)
├── id TEXT PRIMARY KEY
├── title TEXT
├── model TEXT           -- 使用的模型
├── source TEXT          -- 'web' 或 'imessage'
├── imessage_handle TEXT -- iMessage 联系人地址
├── created_at REAL
└── updated_at REAL

messages (消息)
├── id TEXT PRIMARY KEY
├── session_id TEXT      -- 关联会话
├── role TEXT            -- 'user' 或 'assistant'
├── content TEXT
├── model TEXT
└── created_at REAL

imessage_contacts (iMessage 联系人)
├── handle_id TEXT PRIMARY KEY  -- 手机号或邮箱
├── name TEXT
├── auto_reply INTEGER  -- 1=自动回复 0=静默
├── model TEXT          -- 使用的模型
├── trigger_mode TEXT   -- 'always' 或 'prefix:/ai'
└── created_at REAL
```

## API 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检测 |
| GET | `/api/config` | 读取配置 |
| POST | `/api/config` | 更新配置 |
| POST | `/api/config/models` | 添加模型 |
| DELETE | `/api/config/models/:id` | 删除模型 |
| POST | `/api/config/test-model` | 测试模型连接 |
| GET | `/api/config/ollama-models` | 检测 Ollama 已安装模型 |
| POST | `/api/config/tavily` | 配置 Tavily Key |
| GET | `/api/config/tavily/test` | 测试 Tavily 连接 |
| GET | `/api/setup/status` | 引导页环境检测 |
| POST | `/api/setup/pull-model` | 拉取 Ollama 模型（SSE） |
| POST | `/api/setup/configure-cloud` | 配置云端 API Key |
| GET | `/api/models` | 获取模型列表 |
| GET | `/api/sessions` | 获取会话列表 |
| POST | `/api/sessions` | 创建会话 |
| PUT | `/api/sessions/:id` | 更新会话 |
| DELETE | `/api/sessions/:id` | 删除会话 |
| GET | `/api/sessions/:id/messages` | 获取消息 |
| POST | `/api/chat` | 发送消息（SSE 流式） |
| POST | `/api/search` | 联网搜索 |
| GET | `/api/imessage/contacts` | 获取联系人 |
| POST | `/api/imessage/contacts` | 添加联系人 |
| DELETE | `/api/imessage/contacts/:id` | 删除联系人 |
| POST | `/api/imessage/test` | 测试 iMessage |
| GET | `/api/imessage/diagnose` | iMessage 诊断 |
| GET | `/api/imessage/debug` | iMessage 调试 |
| POST | `/api/sleep/toggle` | 切换睡眠阻止 |

## 部署与运行

### 开发模式

```bash
npm run dev          # 同时启动后端(18789) + Vite(5173)
npm run dev:electron # 启动 Electron 桌面应用
```

### 生产打包

```bash
npm run dist:mac     # 打包为 macOS .app (DMG)
```

### 环境要求

- macOS（iMessage 功能依赖）
- Node.js 18+
- Ollama（本地模型，可选）
- Tavily API Key（联网搜索，可选）
- MiMo API Key（云端模型，可选）

## 设计风格

- **主题**：深色毛玻璃风格（类似 macOS 原生暗色模式）
- **字体**：JetBrains Mono（代码） + Instrument Serif（标题）
- **配色**：深黑底 + 暖金色强调色
- **动画**：CSS 动画，进入/退出过渡，打字机效果