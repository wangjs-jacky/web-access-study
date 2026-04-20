# Web Access 使用指南

> 给 AI Agent 装上完整联网能力的 Skill — 三层通道调度 + 浏览器 CDP + 并行分治

## 📌 项目概览

**核心价值**：让 AI Agent（Claude Code、Cursor、Gemini CLI 等）获得像人一样的联网和浏览器操作能力，而非机械地执行固定流程。

**技术特征**：
- Skill 形态（SKILL.md），不侵入 Agent 本体
- 通过 CDP 协议直连用户日常 Chrome，天然携带登录态
- 目标导向的浏览哲学，而非步骤导向的操作手册

**代码规模**：约 11 个文件，核心实现约 550 行（cdp-proxy.mjs）

## 🎮 产品认知（必读）

### 这是什么？

Web Access 是一个 **Claude Code Skill**（技能文件），安装后赋予 AI Agent 完整的联网能力。它不是独立运行的程序，而是一套**思考框架 + 工具箱**，让 Agent 知道"何时用什么方式联网"。

- **产品形态**：SKILL.md 文件 + 辅助脚本（Node.js）
- **安装方式**：将仓库克隆到 Claude Code 的 skills 目录
- **适用场景**：需要搜索信息、抓取网页、操作需要登录的网站、并行调研多个目标

### 核心组件

| 组件 | 形态 | 作用 |
|------|------|------|
| SKILL.md | Markdown 技能文件 | 定义浏览哲学、工具选择策略、CDP 操作指令 |
| cdp-proxy.mjs | Node.js HTTP 服务器 | 将 HTTP 请求转换为 CDP 命令，操控 Chrome |
| check-deps.mjs | Node.js 脚本 | 前置检查 Node.js 版本、Chrome 端口、启动 Proxy |
| match-site.mjs | Node.js 脚本 | 按域名匹配站点经验文件 |
| find-url.mjs | Node.js 脚本 | 从本地 Chrome 书签/历史检索 URL |

### 基本使用方式

1. **安装**：`git clone` 到 Claude Code 的 skills 目录
2. **前置检查**：Agent 自动运行 `check-deps.mjs`
3. **联网操作**：Agent 根据任务性质自动选择 WebSearch / WebFetch / curl / CDP
4. **CDP 操作**：通过 HTTP API（curl）调用 Proxy，Proxy 转为 CDP 命令操控 Chrome

## 🔍 核心概念（含前因后果）

### 概念：三层通道调度

- **是什么**：联网工具按"代价"从轻到重分为四层 — WebSearch → WebFetch/curl → Jina → CDP 浏览器
- **为什么需要**：如果只有 WebSearch，Agent 无法获取完整页面内容；如果只有 CDP，简单查询也要启动浏览器，效率低下。需要根据场景选择最小代价的方式
- **实现思路**：
```
用户请求 → 判断任务性质
  ├─ 搜索发现信息来源 → WebSearch（最轻）
  ├─ URL 已知，定向提取 → WebFetch / curl（中等）
  ├─ 文章类页面 → Jina（节省 token）
  └─ 需登录态/动态页面/反爬严格 → CDP（最重但最全能）
```

### 概念：CDP Proxy

- **是什么**：一个 HTTP 服务器，将 Agent 的 curl 请求翻译成 Chrome DevTools Protocol 的 WebSocket 命令
- **为什么需要**：Agent 只能通过 Bash 执行命令，不能直接操作 WebSocket。需要一个"翻译层"把 HTTP 请求转为 CDP 命令。同时直连用户日常 Chrome，天然携带所有登录态
- **实现思路**：
```
Agent (curl) → HTTP API → CDP Proxy → WebSocket → Chrome → 浏览器操作
                                      ↑
                              自动发现调试端口
                              (DevToolsActivePort 文件)
```

### 概念：并行分治

- **是什么**：多目标时分发子 Agent 并行执行，每个子 Agent 操作独立 tab，共享一个 Proxy
- **为什么需要**：串行处理 5 个目标耗时是 5 倍；并行处理总耗时约等于单个目标。同时抓取内容不进入主 Agent 上下文，节省 token
- **实现思路**：
```
主 Agent → 任务分解 → 子 Agent 1 → tab 1 → 操作 → 关闭
                   → 子 Agent 2 → tab 2 → 操作 → 关闭
                   → 子 Agent 3 → tab 3 → 操作 → 关闭
                                              ↓
                              主 Agent 汇总结果
```

### 概念：站点经验积累

- **是什么**：按域名存储操作经验（URL 模式、平台特征、已知陷阱），跨 session 复用
- **为什么需要**：每个网站的反爬策略、交互逻辑都不同，没有经验每次都要重新探索，浪费时间和 token
- **实现思路**：
```
首次操作 → 探索发现 → 写入 references/site-patterns/{domain}.md
                                    ↓
再次操作 → match-site.mjs 匹配 → 读取经验 → 直接应用
```

### 概念：浏览哲学

- **是什么**：四步目标导向方法论 — ① 明确目标 → ② 选择起点 → ③ 过程校验 → ④ 完成判断
- **为什么需要**：传统操作手册式指令让 AI 遇到障碍时盲目重试，不知道何时该停下来。目标导向让 AI 理解"为什么做"而非只知"做什么"
- **实现思路**：以"技术事实"形式写入 SKILL.md，让 AI 理解 tradeoff 后自主决策

## 🏗️ 系统架构

### 架构图

```
┌──────────────────────────────────────────────────┐
│                   AI Agent                        │
│          (Claude Code / Cursor / etc.)            │
└───────────┬──────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────┐
│              SKILL.md（思考框架）                  │
│  • 浏览哲学：像人一样思考                          │
│  • 工具选择：按场景判断用哪个                       │
│  • CDP 指令：curl 命令模板                         │
│  • 并行分治：子 Agent 调度策略                     │
└───────────┬──────────────────────────────────────┘
            │
    ┌───────┼───────────┐
    ▼       ▼           ▼
WebSearch  WebFetch    CDP Proxy (HTTP :3333)
  (内置)   (内置)          │
                         ▼
                   ┌──────────┐
                   │  Chrome   │
                   │ (用户浏览器)│
                   └──────────┘
```

### 核心数据流

```
1. 用户请求 → Agent 读取 SKILL.md 获取策略
2. Agent 运行 check-deps.mjs → 检查环境 + 启动 Proxy
3. Agent 根据场景选择工具（WebSearch/WebFetch/curl/CDP）
4. 如需 CDP → curl 调用 Proxy HTTP API
5. Proxy → WebSocket → Chrome CDP → 浏览器操作
6. 操作结果 → Agent 整理 → 返回用户
```

### 技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| 技能定义 | Markdown (SKILL.md) | 定义 AI 行为策略和操作模板 |
| 脚本运行时 | Node.js 22+ | 运行辅助脚本（原生 WebSocket） |
| 浏览器通信 | Chrome DevTools Protocol | WebSocket 协议控制 Chrome |
| 代理服务 | HTTP Server (Node.js) | HTTP → WebSocket 翻译层 |
| 本地检索 | SQLite3 | 读取 Chrome 历史记录 |

## 🗺️ 关键文件地图

| 优先级 | 文件路径 | 行数 | 职责 | 何时阅读 |
|--------|---------|------|------|---------|
| ⭐⭐⭐ | `SKILL.md` | ~250 | Skill 核心：哲学 + 策略 + 指令 | 第一时间阅读 |
| ⭐⭐⭐ | `scripts/cdp-proxy.mjs` | ~550 | CDP Proxy 核心实现 | 理解浏览器操控机制 |
| ⭐⭐ | `scripts/check-deps.mjs` | ~170 | 环境检查与 Proxy 启动 | 理解启动流程 |
| ⭐⭐ | `scripts/find-url.mjs` | ~150 | Chrome 书签/历史检索 | 理解本地资源检索 |
| ⭐ | `scripts/match-site.mjs` | ~40 | 站点经验匹配 | 理解经验复用机制 |
| ⭐ | `references/cdp-api.md` | ~50 | CDP API 速查 | 需要扩展 CDP 操作时 |

### ⚠️ 高风险文件

| 文件 | 风险 | 说明 |
|------|------|------|
| `scripts/cdp-proxy.mjs` | 修改影响大 | 核心代理逻辑，所有浏览器操作依赖此文件 |
| `SKILL.md` | 行为影响大 | 直接决定 AI Agent 的行为策略，修改需谨慎 |

## 💡 核心设计决策

| 问题 | 方案 | 原因 | 不这样做的后果 |
|------|------|------|-------------|
| 如何指导 AI 联网？ | 目标导向 + 技术事实 | 让 AI 理解 tradeoff 后自主决策 | 步骤导向导致遇到异常时僵化 |
| 如何连接浏览器？ | 直连用户日常 Chrome | 复用登录态，零配置 | 独立启动浏览器无登录态 |
| 如何暴露 CDP 能力？ | HTTP Proxy 转发 | Agent 只能执行 bash 命令 | Agent 无法直接操作 WebSocket |
| 多任务如何处理？ | 并行分治 + tab 隔离 | 效率提升 + 保护主上下文 | 串行处理慢，内容占满上下文 |
| 经验如何管理？ | Markdown 文件按域名存储 | 简单直观，易于编辑和版本管理 | 数据库过重，单文件不易管理 |

## 🚀 本地搭建（5 步内）

### 前置条件

| 工具 | 要求 | 说明 |
|------|------|------|
| Node.js | 22+ | 使用原生 WebSocket |
| Chrome | 开启远程调试 | chrome://inspect → 勾选远程调试 |
| sqlite3 | 可选 | 用于 find-url.mjs 的历史检索 |

### 安装步骤

1. **克隆仓库**：`git clone https://github.com/eze-is/web-access.git`
2. **安装到 Agent**：将 SKILL.md 放入 skills 目录（各 Agent 路径不同）
3. **开启 Chrome 调试**：地址栏打开 `chrome://inspect/#remote-debugging`，勾选允许
4. **运行检查**：`node scripts/check-deps.mjs` 确认环境就绪
5. **验证**：在 Agent 中输入任意联网请求，观察是否自动选择工具

## 🐛 调试指南

### 各组件调试入口

| 组件 | 打开方式 | 说明 |
|------|---------|------|
| CDP Proxy | `curl http://127.0.0.1:3333/targets` | 查看 Chrome 连接状态 |
| Chrome 端口 | `cat ~/Library/Application Support/Google/Chrome/DevToolsActivePort` | 查看调试端口号 |
| 站点经验 | `ls references/site-patterns/` | 查看已有经验文件 |

### 常见问题排查

**问题：Proxy 启动后连接超时**
- 原因：Chrome 未开启远程调试端口
- 排查：检查 `chrome://inspect/#remote-debugging` 是否勾选

**问题：页面检测到自动化操作**
- 原因：网站通过探测 CDP 端口检测自动化
- 排查：确认 `portGuard` 逻辑是否生效（拦截 127.0.0.1:{port} 请求）

**问题：find-url.mjs 无法读取历史**
- 原因：Chrome 运行时锁定 History 文件
- 排查：脚本会自动复制到临时目录，确认 sqlite3 已安装

## 🎯 适合谁用

| 角色 | 场景 |
|------|------|
| AI Agent 开发者 | 学习如何设计高上限的 Skill |
| Claude Code 用户 | 增强 Agent 的联网和浏览器操作能力 |
| 浏览器自动化开发者 | 参考 CDP Proxy 的实现方式 |
| Prompt 工程师 | 学习"技术事实"驱动的指令设计 |

## 📖 进阶阅读

- [项目设计详解（微信公众号）](https://mp.weixin.qq.com/s/rps5YVB6TchT9npAaIWKCw) — 作者详细介绍设计哲学和开发细节
- [CDP 协议官方文档](https://chromedevtools.github.io/devtools-protocol/) — Chrome DevTools Protocol 完整参考
- `references/cdp-api.md` — 项目内置的 CDP API 速查
