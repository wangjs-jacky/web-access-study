---
article_id: OBA-c1t8lviw
---

# web-access 端到端数据流分析

> 追踪从用户发起请求到结果返回的完整链路，理解 web-access 各组件如何协作。

## 定位

- **给谁看**：想理解 web-access 各组件如何连接成完整系统的人
- **解决什么问题**：回答「一个请求从头到尾经过了哪些环节、数据如何在组件间流转」
- **前置笔记**：[architecture-overview.md](architecture-overview.md)（架构概述），本篇聚焦数据流

## 一、端到端请求链路全景图

```
用户请求（联网需求）
    │
    ▼
┌─────────────────────────────────────┐
│  Claude Code + SKILL.md             │
│  - 工具选择决策（三层通道）          │
│  - 成功标准定义                      │
│  - 站点经验匹配                      │
└──────────────┬──────────────────────┘
               │ Bash 调用
               ▼
┌─────────────────────────────────────┐
│  check-deps.mjs                     │
│  - Node.js 版本                     │
│  - Chrome 端口发现                   │
│  - CDP Proxy 启动/检查              │
│  - 站点经验列表输出                  │
└──────────────┬──────────────────────┘
               │ HTTP API
               ▼
┌─────────────────────────────────────┐
│  cdp-proxy.mjs（HTTP 服务器）       │
│  - 端口 3456                        │
│  - RESTful API                      │
└──────────────┬──────────────────────┘
               │ WebSocket
               ▼
┌─────────────────────────────────────┐
│  Chrome DevTools Protocol           │
│  - Target / Page / Runtime / DOM    │
│  - Input / Fetch                    │
└─────────────────────────────────────┘
               │
               ▼
          返回结果
```

## 二、各阶段详解

### 2.1 用户请求发起

当用户在 Claude Code 中提出联网需求，系统自动加载 web-access skill。

**工具选择决策矩阵**：

```
任务分类 → 工具选择
├─ 搜索/发现信息来源    → WebSearch
├─ URL 已知，定向提取   → WebFetch / curl
└─ 登录态/交互/动态内容 → CDP 浏览器
```

### 2.2 前置检查（check-deps.mjs）

```
check-deps 执行流程
├─ 1. Node.js 版本检查（≥22 推荐）
├─ 2. Chrome 端口检测
│  ├─ 读取 DevToolsActivePort 文件（多平台路径）
│  └─ 回退扫描 [9222, 9229, 9333]
├─ 3. Proxy 状态检查
│  ├─ GET http://localhost:3456/targets
│  ├─ 已运行 → ready
│  └─ 未运行 → 启动守护进程 + 等待就绪（17秒超时）
└─ 4. 输出站点经验列表
```

### 2.3 CDP Proxy 启动（cdp-proxy.mjs）

```
cdp-proxy 启动流程
├─ 端口冲突检测（3456 端口）
├─ HTTP 服务器启动（127.0.0.1:3456）
├─ 异步连接 Chrome（非阻塞）
└─ 注册全局异常处理器
```

**为什么用 HTTP API 而非暴露 WebSocket？**
- 简单的 curl 调用接口
- HTTP 状态码提供清晰错误信号
- 与 Claude Code 的 Bash 工具天然兼容

### 2.4 Chrome 连接建立

```
连接发现流程
├─ 读取 DevToolsActivePort 文件
│  格式：9222\n/devtools/browser/uuid
│
├─ TCP 探测验证（避免安全弹窗）
│
└─ WebSocket 连接建立
   ws://127.0.0.1:{port}{wsPath}
   注册事件：open/error/close/message
```

### 2.5 请求执行（HTTP API 路由）

```
HTTP API 路由全景
├─ /health       → 连接状态检查
├─ /targets      → 列出所有页面 tab
├─ /new?url=xxx  → 创建新 tab + 自动等待加载
├─ /close?target → 关闭 tab
├─ /navigate     → 导航到 URL + 等待加载
├─ /back         → 浏览器后退
├─ /eval         → 执行 JS 表达式
├─ /click        → JS 层面点击（快速）
├─ /clickAt      → CDP 真实鼠标点击（手势级）
├─ /setFiles     → 文件上传（绕过对话框）
├─ /scroll       → 滚动页面
├─ /screenshot   → 截图
└─ /info         → 页面信息（title/url/readyState）
```

### 2.6 CDP 命令执行（sendCDP）

```
CDP 命令发送流程
├─ 检查 WebSocket 连接状态
├─ 生成唯一命令 ID (cmdId++)
├─ 构建消息：{ id, method, params, sessionId? }
├─ 设置 30 秒超时定时器
├─ 注册 Promise 到 pending Map
├─ ws.send(JSON.stringify(msg))
└─ 等待响应（onMessage 中 ID 匹配后 resolve）
```

### 2.7 响应处理与返回

```
响应处理链
├─ 解析 CDP 响应
│  ├─ Runtime.evaluate → resp.result?.result?.value
│  ├─ Page.captureScreenshot → base64 数据
│  └─ 其他 → resp.result
│
├─ 格式化 HTTP 响应
│  ├─ 成功：{ value: ... }
│  ├─ 失败：{ error: ... } + HTTP 状态码
│  └─ 截图：直接返回二进制
│
└─ 错误处理
   ├─ 400：参数错误
   ├─ 500：内部错误
   └─ 404：未知端点
```

## 三、三层通道调度机制

### 3.1 层级设计

```
┌─────────────────────────────────────────────┐
│ 第一层：发现层（WebSearch）                   │
│ - 定位信息来源                                │
│ - 最快、成本最低                              │
│ - 适用：关键词搜索、信息发现                   │
├─────────────────────────────────────────────┤
│ 第二层：提取层（WebFetch / curl）             │
│ - URL 已知时定向获取内容                      │
│ - 中等速度、中等成本                          │
│ - 适用：静态页面、结构化数据提取               │
├─────────────────────────────────────────────┤
│ 第三层：交互层（CDP 浏览器）                  │
│ - 动态内容、登录态、复杂交互                  │
│ - 最可靠但最慢                                │
│ - 适用：反爬平台、表单提交、登录操作           │
└─────────────────────────────────────────────┘
```

### 3.2 升级触发条件

| 当前层级 | 升级条件 | 升级目标 |
|---------|---------|---------|
| WebSearch | 多次搜索无质变 | 直接访问一手来源 |
| WebFetch/curl | 静态层无效（反爬） | CDP 浏览器 |
| WebFetch/curl | 需要登录态 | CDP 浏览器 |
| 程序化 CDP | 触发反爬检测 | GUI 交互 CDP |

### 3.3 程序化 vs GUI 权衡

```
程序化方式（eval + 构造 URL）
├─ 优势：速度快、精确
└─ 风险：可能触发反爬

GUI 交互（点击、填写、滚动）
├─ 优势：确定性高、正常用户行为
└─ 代价：步骤多、速度慢

协作模式：GUI 探测 → 理解站点 → 程序化规模化
```

## 四、组件间通信协议

### 4.1 SKILL.md → 脚本（Bash 调用）

```bash
# 前置检查
node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"

# 本地资源检索
node "${CLAUDE_SKILL_DIR}/scripts/find-url.mjs" 关键词 --limit 10

# 站点匹配
node "${CLAUDE_SKILL_DIR}/scripts/match-site.mjs" "github.com"
```

- 通过 Bash 工具执行 Node.js 脚本
- 标准输出返回结果
- 非零退出码表示错误

### 4.2 脚本 → CDP Proxy（HTTP API）

```bash
curl -s http://localhost:3456/targets
curl -s "http://localhost:3456/new?url=https://example.com"
curl -s -X POST "http://localhost:3456/eval?target=ID" -d 'document.title'
```

- RESTful HTTP API
- GET 用于查询，POST 用于需要 body 的操作
- JSON 响应格式

### 4.3 CDP Proxy → Chrome（WebSocket 消息）

**请求格式**：

```json
{
  "id": 1,
  "method": "Runtime.evaluate",
  "params": { "expression": "document.title", "returnByValue": true },
  "sessionId": "xxx-xxx"
}
```

**响应格式**：

```json
{
  "id": 1,
  "result": { "result": { "type": "string", "value": "页面标题" } }
}
```

**事件格式**：

```json
{
  "method": "Target.attachedToTarget",
  "params": { "sessionId": "xxx", "targetInfo": { "targetId": "yyy" } }
}
```

### 4.4 错误信号逐层传递

```
Chrome 端错误
├─ WebSocket 断开 → cdp-proxy 清除缓存，下次重连
├─ CDP 命令失败 → pending.reject，HTTP 500 返回
└─ 超时 → 30秒后 reject

CDP Proxy 错误
├─ HTTP 400：参数错误
├─ HTTP 500：内部错误
└─ JSON：{ error: "..." }

Bash 调用错误
├─ 非零退出码 → 检查失败
└─ 标准错误输出 → 错误信息

SKILL 决策错误
├─ 重新评估方向（过程校验）
├─ 切换工具层级
└─ 请求用户介入（如登录）
```

## 五、CDP API 使用清单

| CDP 域 | 命令 | 用途 | 对应 API |
|--------|------|------|---------|
| **Target** | getTargets | 列出页面 | GET /targets |
| | createTarget | 创建 tab | GET /new |
| | attachToTarget | 建立会话 | 内部（ensureSession） |
| | closeTarget | 关闭 tab | GET /close |
| **Page** | enable | 启用页面域 | 内部（waitForLoad） |
| | navigate | 导航 | GET /navigate |
| | captureScreenshot | 截图 | GET /screenshot |
| **Runtime** | evaluate | 执行 JS | POST /eval |
| **DOM** | enable | 启用 DOM 域 | 内部（setFiles） |
| | getDocument | 获取文档 | 内部（setFiles） |
| | querySelector | 查找元素 | 内部（setFiles） |
| | setFileInputFiles | 设置文件 | POST /setFiles |
| **Input** | dispatchMouseEvent | 鼠标事件 | POST /clickAt |
| **Fetch** | enable | 启用拦截 | 内部（反风控） |
| | failRequest | 拒绝请求 | 内部（反风控） |

## 六、关键设计决策

### 6.1 为什么用 HTTP API 封装 CDP？

```
CDP 原生接口（WebSocket）
├─ 复杂：需要管理连接、会话、命令 ID
├─ 调试难：WebSocket 消息不直观
└─ 不兼容：Claude Code 用 Bash 工具执行命令

HTTP API 封装
├─ 简单：curl 命令即可调用
├─ 调试易：HTTP 状态码 + JSON 响应
└─ 兼容好：与 Bash 工具天然配合
```

### 6.2 为什么用独立 Proxy 守护进程？

```
每次请求都连接
├─ 慢：WebSocket 握手 + 授权弹窗
├─ 不稳定：频繁连接断开
└─ 资源浪费

守护进程模式
├─ 快：连接建立后复用
├─ 稳定：持续运行，断线自动重连
└─ 高效：会话缓存，命令复用
```

### 6.3 为什么轮询等待而非事件监听？

```javascript
// waitForLoad 的实现选择
const checkInterval = setInterval(async () => {
  const resp = await sendCDP('Runtime.evaluate', {
    expression: 'document.readyState',
    returnByValue: true,
  }, sessionId);
  if (resp.result?.result?.value === 'complete') done('complete');
}, 500);
```

- 实现简单，不需要复杂的事件管理
- 500ms 间隔足够快
- 超时机制（15s）防止无限等待
- 跨平台兼容性好

### 6.4 为什么区分 /click 和 /clickAt？

| 方式 | 实现 | 优势 | 适用场景 |
|------|------|------|---------|
| `/click` | JS `el.click()` | 快速简单 | 大多数场景 |
| `/clickAt` | CDP `Input.dispatchMouseEvent` | 真实手势、触发对话框 | 文件上传、反自动化检测 |

## 七、反风控数据流

```
CDP Proxy 启用反风控（enablePortGuard）
    │
    ├─ Fetch.enable 拦截对调试端口的请求
    │
    ▼
页面 JS 试图访问 localhost:9222
    │
    ▼
Fetch.requestPaused 事件触发
    │
    ▼
代理返回 Fetch.failRequest(ConnectionRefused)
    │
    ▼
页面无法探测到调试端口的存在
```

配合 `/clickAt` 的真实鼠标事件，形成完整的反风控策略。

## 八、总结

web-access 数据流设计的核心原则：

1. **分层渐进**：三层通道自动升级，低成本优先
2. **守护进程**：独立 Proxy 管理连接状态，避免频繁握手
3. **HTTP 封装**：简化 CDP WebSocket 接口，提高易用性
4. **目标导向**：每次操作对照成功标准，灵活调整策略
5. **错误传递**：清晰的层次化错误边界，不丢失上下文
6. **反风控内置**：端口拦截 + 真实手势，模拟正常用户行为
