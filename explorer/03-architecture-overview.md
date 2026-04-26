---
article_id: OBA-ab2jmo69
article_id: OBA-ps2nbg2j
tags: [study-note]
type: note
created_at: 2026-04-25
updated_at: 2026-04-25
---
article_id: OBA-ab2jmo69

# Web Access 架构与核心机制

> 分析 Web Access 的架构设计、三层通道调度、CDP Proxy 实现、并行分治策略

## 背景问题

全面研究 eze-is/web-access 项目的技术实现，理解其如何给 AI Agent 装上完整联网能力。

## 核心发现

### 1. 设计哲学：Skill = 哲学 + 技术事实

Web Access 最大的创新是**不给 AI 固定操作流程，而是教它如何思考**。SKILL.md 以"技术事实"形式呈现 tradeoff，让 AI 理解"为什么这样做"后自主决策。

例如不说"遇到小红书就用 CDP"，而是说"小红书是已知静态层无效的平台"。

### 2. 四层工具调度

从轻到重：WebSearch → WebFetch/curl → Jina → CDP 浏览器。Agent 根据任务性质自动选择最小代价的方式：

- 简单搜索 → WebSearch
- URL 已知 → WebFetch / curl
- 需登录态/动态页面 → CDP

### 3. CDP Proxy 核心实现

HTTP 服务器将 curl 请求转为 WebSocket 的 CDP 命令。关键设计：
- **自动发现端口**：读取 `DevToolsActivePort` 文件，回退扫描常用端口
- **反风控**：拦截页面对 `127.0.0.1:{port}` 的探测请求
- **三种点击**：JS click（快）、CDP 真实鼠标（能触发文件对话框）、setFiles（绕过对话框）
- **tab 隔离**：每个操作在独立后台 tab 中进行

### 4. 并行分治

多目标时分发子 Agent 并行执行：
- 共享一个 Chrome、一个 Proxy
- 通过不同 targetId 操作不同 tab
- 主 Agent 只接收摘要，节省上下文

### 5. 站点经验积累

按域名存储操作经验（`references/site-patterns/{domain}.md`），包括平台特征、URL 模式、已知陷阱。跨 session 复用，避免重复踩坑。

## 关键代码位置

- `SKILL.md:33-46` — 浏览哲学四步方法论
- `SKILL.md:47-59` — 工具选择策略表
- `scripts/cdp-proxy.mjs:36-91` — Chrome 端口自动发现
- `scripts/cdp-proxy.mjs:109-200` — WebSocket 连接管理
- `scripts/cdp-proxy.mjs:235-248` — 反风控端口拦截
- `scripts/cdp-proxy.mjs:288-551` — HTTP API 端点实现
- `scripts/check-deps.mjs:107-139` — Proxy 自动启动与等待
- `scripts/find-url.mjs:84-149` — Chrome 书签/历史检索
- `scripts/match-site.mjs` — 站点经验正则匹配

## 可复用模式

1. **"技术事实"驱动的 Skill 设计**：不写操作手册，写 tradeoff，让 AI 自主决策
2. **HTTP Proxy 模式**：Agent 只能执行 bash → 通过 HTTP Proxy 暴露复杂能力（如 CDP）
3. **自动发现 + 优雅降级**：先尝试精确路径，再扫描常用端口
4. **反风控端口拦截**：拦截页面对调试端口的探测，防止自动化检测
5. **临时文件读取锁定的 SQLite**：复制 Chrome History 到临时目录再查询
