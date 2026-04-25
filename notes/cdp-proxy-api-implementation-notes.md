---
article_id: OBA-zvsq5uhs
tags: [study-note]
type: note
created_at: 2026-04-25
updated_at: 2026-04-25
---

# CDP Proxy API 与实现逻辑笔记

## 1. 这份代理在做什么

`web-access/scripts/cdp-proxy.mjs` 把 Chrome DevTools Protocol（CDP）包装成一个本地 HTTP 服务（默认 `http://127.0.0.1:3456`），让外部只用 `curl`/HTTP 就能控制日常 Chrome。

对应的公开接口说明在 `web-access/references/cdp-api.md`，源码实现与文档基本一致，核心是：
- 自动发现 Chrome 调试端口并建立 WebSocket 连接
- 为每个 tab 建立 `targetId -> sessionId` 映射
- 把 HTTP 请求翻译为 CDP 命令

## 2. 启动与连接模型

### 2.1 单实例策略
- 启动时先检查端口是否可监听。
- 如果端口被占用，会调用 `/health` 探测是否已有 cdp-proxy。
- 已有实例则直接退出；否则报“端口已占用”。

### 2.2 Chrome 自动发现
按顺序尝试：
1. 读取 `DevToolsActivePort`（不同平台多个候选路径）
2. 对发现端口做 TCP 探活（避免 WebSocket 探测触发 Chrome 安全弹窗）
3. 扫描常见端口 `9222/9229/9333`

发现后拼接 WebSocket URL：
- 优先 `ws://127.0.0.1:<port><wsPath>`（来自 `DevToolsActivePort` 第二行）
- 否则 `ws://127.0.0.1:<port>/devtools/browser`

### 2.3 连接复用与重连
- `connectingPromise` 防止并发请求重复建连。
- 连接断开后会清空 `ws/chromePort/chromeWsPath/sessions`，后续请求会重新发现并连接。

## 3. 核心内存状态

- `pending: Map<id, {resolve, timer}>`：CDP 请求-响应匹配，30s 超时。
- `sessions: Map<targetId, sessionId>`：tab 到 CDP session 的映射。
- `portGuardedSessions: Set<sessionId>`：记录已启用防探测拦截的 session。
- `cmdId`：递增消息 ID。

## 4. HTTP API 到 CDP 的映射

| HTTP 端点 | 关键 CDP 命令 | 说明 |
|---|---|---|
| `GET /targets` | `Target.getTargets` | 过滤 `type=page` 返回 tab 列表 |
| `GET /new` | `Target.createTarget` | 新建后台 tab，非 `about:blank` 会等待加载 |
| `GET /close` | `Target.closeTarget` | 关闭 tab 并移除 session 缓存 |
| `GET /navigate` | `Page.navigate` | 导航后调用 `waitForLoad()` |
| `GET /back` | `Runtime.evaluate(history.back())` | 执行后退并等待加载 |
| `POST /eval` | `Runtime.evaluate` | 支持 `awaitPromise`，返回可序列化值 |
| `POST /click` | `Runtime.evaluate(el.click())` | JS 层点击，快但不是真实鼠标事件 |
| `POST /clickAt` | `Runtime.evaluate + Input.dispatchMouseEvent` | 浏览器级鼠标按下/释放，更像真实用户手势 |
| `POST /setFiles` | `DOM.getDocument/querySelector/setFileInputFiles` | 绕过文件对话框设置 file input |
| `GET /scroll` | `Runtime.evaluate(window.scroll*)` | 支持 `down/up/top/bottom`，并等待 800ms |
| `GET /screenshot` | `Page.captureScreenshot` | 返回二进制或写本地文件 |
| `GET /info` | `Runtime.evaluate` | 返回 `title/url/readyState` |

## 5. 会话 attach 与防端口探测

### 5.1 ensureSession()
对每个 target：
- 已有 `sessionId` 就复用
- 没有则 `Target.attachToTarget(flatten: true)` 并缓存

### 5.2 enablePortGuard()
对 session 启用 `Fetch.enable`，拦截：
- `http://127.0.0.1:<chromePort>/*`
- `http://localhost:<chromePort>/*`

当页面请求命中时，`Fetch.requestPaused` 会被处理为：
- `Fetch.failRequest(errorReason=ConnectionRefused)`

目的：阻断站点对本机 Chrome 调试端口的探测，降低被识别为自动化环境的概率。

## 6. waitForLoad 的实际语义

`waitForLoad()` 逻辑是轮询 `document.readyState`，直到 `complete` 或超时（默认 15s）。
这意味着它代表“文档层加载完成”，不等价于“业务页面已完全可交互”（比如 SPA 还在异步拉数据）。

## 7. 误差点与维护注意事项

- `/setFiles` 直接 `JSON.parse(body)`，非法 JSON 会进入 500。
- WebSocket 异常断开时，部分 `pending` 请求可能最终走超时错误。
- `click` 与 `clickAt` 语义不同：
  - `click` 适合普通按钮交互。
  - `clickAt` 适合需要“真实用户手势”的场景（如更严格的前端事件判断）。
- `/health` 不强制连 Chrome，只反映 proxy 当前连接状态；`connected=false` 不代表服务不可用（首次调用其他接口会触发重连）。

## 8. 一句话总结

这个 proxy 的设计重点不是“覆盖全部 CDP 能力”，而是把常见网页自动化动作做成稳定、可重连、低接入成本的 HTTP 包装层，并额外处理了本地调试端口探测这类反自动化细节。
