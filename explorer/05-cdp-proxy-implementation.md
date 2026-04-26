---
article_id: OBA-xqxiufb6
tags: [study-note, implementation]
type: note
created_at: 2026-04-25
updated_at: 2026-04-26
---

# CDP Proxy 完整实现详解

> **你为什么会在这里**：你已经用 curl 控制过浏览器了（how-to-guide），现在想理解 Proxy 内部是怎么工作的。

## 它在做什么（一句话）

CDP Proxy 是一个本地 HTTP 服务器（默认 `localhost:3456`），把你发出的 curl 请求翻译成 Chrome DevTools Protocol 的 WebSocket 命令。

```
你执行：curl http://localhost:3456/new?url=https://example.com
    ↓
Proxy 收到 HTTP 请求
    ↓
Proxy 通过 WebSocket 发送 CDP 命令给 Chrome：Target.createTarget
    ↓
Chrome 创建新 tab
    ↓
Proxy 把结果转成 JSON 返回给你：{"targetId":"ABC123"}
```

**为什么要加这层翻译？** 因为 CDP 基于 WebSocket，而 Agent（和你）用的是 HTTP/curl。加一层 Proxy，所有浏览器操作就变成了简单的 HTTP 调用。

## 一、启动与连接

### 1.1 单实例保障

启动时先检查端口是否可监听：
- 端口可用 → 正常启动
- 端口被占用 → 调 `/health` 探测是否已有 Proxy 在运行
  - 已有实例 → 直接退出，复用现有实例
  - 不是 Proxy → 报错退出

**为什么这样设计？** 多个 Proxy 实例连接同一个 Chrome 会冲突。单实例策略避免了这个问题。

### 1.2 Chrome 端口自动发现

`discoverChromePort()`（cdp-proxy.mjs:36-91）三层回退：

```
第一层：读取 DevToolsActivePort 文件
  Chrome 自动生成的文件，第一行是端口号，第二行是 WebSocket 路径
    ↓ 文件不存在或端口不通？
第二层：扫描常用端口（9222, 9229, 9333）
    ↓ 都不通？
第三层：报错，引导用户开启调试端口
```

**关键细节：TCP 探测而非 WebSocket**

```javascript
function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, '127.0.0.1');
    // 只建立 TCP 连接，不发送任何数据
    socket.once('connect', () => { socket.destroy(); resolve(true); });
  });
}
```

为什么不用 WebSocket 探测？因为 Chrome 有安全机制——**未授权的 WebSocket 连接会触发安全弹窗**（"是否允许远程调试？"）。TCP 探测只建立连接然后断开，不触发弹窗。

**DevToolsActivePort 的第二行**

```
9222                              ← 端口号
/devtools/browser/a1b2c3d4-xxxx  ← 带 UUID 的 WebSocket 路径
```

非 `--remote-debugging-port` 启动时，Chrome 只接受带 UUID 路径的 WebSocket 连接（安全令牌）。Proxy 读取这个路径拼接 WebSocket URL。

### 1.3 连接管理

```javascript
let connectingPromise = null;

async function connect() {
  if (ws && ws.readyState === WS.OPEN) return;       // 已连接，直接用
  if (connectingPromise) return connectingPromise;     // 正在连接，复用 Promise
  // ... 新建连接
}
```

**为什么需要 `connectingPromise`？** 多个请求可能同时到达（比如并行分治时多个子 Agent 同时操作）。如果每次都新建连接，会触发并发连接问题。缓存正在进行的连接 Promise，后续请求等待同一个连接完成即可。

连接断开时自动清空所有缓存状态（端口、session），下次请求自动重新发现和连接。

## 二、核心状态

Proxy 运行时维护 4 个关键数据结构：

```javascript
let ws = null;                           // WebSocket 连接
let cmdId = 0;                           // 递增命令 ID
const pending = new Map();               // id → {resolve, timer}   请求-响应匹配
const sessions = new Map();              // targetId → sessionId    tab 会话映射
const portGuardedSessions = new Set();   // sessionId               已启用反探测的 session
```

### 2.1 Pending Map：异步请求-响应匹配

这是 Proxy 最核心的设计模式。

CDP 通过 WebSocket 发命令，Chrome 异步返回结果。问题是：连续发了 5 条命令，回复顺序不一定和发送顺序一致。怎么知道哪条回复对应哪条命令？

```javascript
function sendCDP(method, params = {}, sessionId = null) {
  return new Promise((resolve, reject) => {
    const id = ++cmdId;                    // 每条命令分配唯一 ID
    const msg = { id, method, params };    // Chrome 会原样返回这个 id
    if (sessionId) msg.sessionId = sessionId;

    const timer = setTimeout(() => {       // 30 秒超时保护
      pending.delete(id);
      reject(new Error('CDP 命令超时: ' + method));
    }, 30000);

    pending.set(id, { resolve, timer });   // 存起来，等 Chrome 回复
    ws.send(JSON.stringify(msg));
  });
}

// Chrome 回复时自动匹配：
// msg.id → 在 pending 中找到对应 resolve → 触发 Promise
```

**这个模式的通用性**：不仅适用于 CDP。任何"发出去等回来"的异步场景都能用——JSON-RPC、消息队列、WebSocket RPC。

### 2.2 Session 管理：多 Tab 隔离

每个 tab 有独立的 `targetId`，要操作某个 tab 必须先 attach：

```javascript
async function ensureSession(targetId) {
  if (sessions.has(targetId)) return sessions.get(targetId);  // 缓存命中
  const resp = await sendCDP('Target.attachToTarget', { targetId, flatten: true });
  const sid = resp.result.sessionId;
  sessions.set(targetId, sid);                                 // 缓存映射
  await enablePortGuard(sid);                                  // 启用反探测
  return sid;
}
```

后续所有命令都带 `sessionId`，Chrome 就知道是操作哪个 tab。不同 tab 的操作完全隔离。

## 三、HTTP API → CDP 命令映射

| HTTP 端点 | CDP 命令 | 关键行为 |
|-----------|---------|---------|
| `GET /targets` | `Target.getTargets` | 过滤 `type=page` |
| `GET /new` | `Target.createTarget` | `background: true`，非 about:blank 自动 `waitForLoad` |
| `GET /close` | `Target.closeTarget` | 关闭 tab + 清除 session 缓存 |
| `GET /navigate` | `Page.navigate` | 导航后 `waitForLoad`（500ms 轮询 readyState，15s 超时） |
| `GET /back` | `Runtime.evaluate(history.back())` | 后退 + 等待加载 |
| `POST /eval` | `Runtime.evaluate` | `awaitPromise: true`，返回可序列化值 |
| `POST /click` | `Runtime.evaluate(el.click())` | JS 层点击，快但非真实手势 |
| `POST /clickAt` | `Input.dispatchMouseEvent` | 获取坐标 → mousePressed → mouseReleased，真实手势 |
| `POST /setFiles` | `DOM.setFileInputFiles` | 绕过文件对话框直接设置文件 |
| `GET /scroll` | `Runtime.evaluate(window.scroll*)` | 四方向，滚后等 800ms 触发懒加载 |
| `GET /screenshot` | `Page.captureScreenshot` | 保存到文件或返回二进制 |
| `GET /info` | `Runtime.evaluate` | 返回 title/url/readyState |

### 三种点击策略对比

| 策略 | 命令 | 能力 | 速度 | 适用场景 |
|------|------|------|------|---------|
| JS 点击 `/click` | `el.click()` | 普通按钮交互 | 快 | 大多数场景 |
| 真实鼠标 `/clickAt` | `Input.dispatchMouseEvent` | 触发文件对话框、绕过反自动化 | 中 | 需要真实用户手势 |
| 直接设置 `/setFiles` | `DOM.setFileInputFiles` | 绕过对话框直接上传文件 | 快 | 文件上传专用 |

**选择逻辑**：先用 `/click`，不行就用 `/clickAt`，文件上传用 `/setFiles`。

## 四、反风控：端口探测拦截

有些网站会探测 `127.0.0.1:9222`（Chrome 调试端口），如果发现端口开放，就判定为自动化环境。

Proxy 的应对：在每个 tab 的 session 中启用 `Fetch.enable`，拦截对 Chrome 调试端口的请求：

```javascript
async function enablePortGuard(sessionId) {
  await sendCDP('Fetch.enable', {
    patterns: [
      { urlPattern: `http://127.0.0.1:${chromePort}/*`, requestStage: 'Request' },
      { urlPattern: `http://localhost:${chromePort}/*`, requestStage: 'Request' },
    ]
  }, sessionId);

  // 页面发起的匹配请求会被 Fetch.requestPaused 事件拦截
  // 然后返回 Fetch.failRequest(ConnectionRefused)
}
```

只拦截 Chrome 调试端口，不影响页面对其他本地服务的正常请求。

## 五、waitForLoad 的实际语义

`waitForLoad()` 轮询 `document.readyState` 直到 `complete` 或超时（15s）。

**注意**：`readyState === 'complete'` ≠ 业务页面完全可交互。SPA 可能在 HTML 加载完后很久才渲染实际内容。如果需要确认特定内容已加载，用 `/eval` 检查目标元素是否存在更可靠。

## 六、代码位置速查

| 功能 | 文件:行号 |
|------|----------|
| 端口自动发现 | `cdp-proxy.mjs:36-91` |
| TCP 探测 | `cdp-proxy.mjs:94-102` |
| WebSocket 连接管理 | `cdp-proxy.mjs:114-200` |
| sendCDP (Pending Map) | `cdp-proxy.mjs:202-217` |
| Session 管理 | `cdp-proxy.mjs:222-233` |
| 反风控端口拦截 | `cdp-proxy.mjs:237-248` |
| waitForLoad | `cdp-proxy.mjs:251-278` |
| 全部 HTTP API 端点 | `cdp-proxy.mjs:288-551` |
| 服务器启动逻辑 | `cdp-proxy.mjs:564-591` |
