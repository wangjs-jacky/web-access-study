---
article_id: OBA-ttzknduq
---

# cdp-proxy.mjs 逐行精读

> 深入 601 行 CDP 代理服务器的每一个细节，理解它如何将 Chrome DevTools Protocol 封装为简洁的 HTTP API。

## 定位

- **给谁看**：想理解 web-access 核心引擎底层实现的人
- **解决什么问题**：回答「cdp-proxy 到底做了什么、怎么做的、为什么这样设计」
- **前置笔记**：[cdp-proxy-deep-dive.md](cdp-proxy-deep-dive.md)（机制概述），本篇是逐行精读版

## 一、整体架构

### 1.1 模块结构

这是一个基于 Node.js 的 CDP (Chrome DevTools Protocol) 代理服务器，整体分为三大核心模块：

**依赖导入** (第6-11行)：
- 原生模块：http, fs, path, os, net
- 兼容层：WebSocket 适配器（Node 22+ 用原生，否则用 ws 模块）

**核心状态管理** (第13-18行)：

```javascript
const PORT = parseInt(process.env.CDP_PROXY_PORT || '3456');
let ws = null;                              // WebSocket 连接实例
let cmdId = 0;                             // 自增命令 ID
const pending = new Map();                 // 异步请求-响应映射
const sessions = new Map();                // 目标 ID 到会话 ID 映射
```

**主入口** (第564-601行)：
- `main()` 函数执行初始化
- 端口冲突检测
- 启动 HTTP 服务器
- 注册全局异常处理器

### 1.2 数据流图

```
[客户端请求] → [HTTP Server] → [路由分发] → [ensureSession] → [sendCDP]
                                              ↓
                                          [连接管理]
                                              ↓
                                        [WebSocket消息]
                                              ↓
                                          [消息路由]
                                              ↓
                                    [Pending Map匹配] → [响应回传]
```

## 二、端口发现机制

### 2.1 多层次发现策略

**第一层：DevToolsActivePort 文件** (第38-78行)

Chrome 启动时会创建 `DevToolsActivePort` 文件，包含调试端口和 WebSocket 路径：

```javascript
// 文件格式示例：
// 9222
// /devtools/browser/cd9f2e1a-3c4d-4e5f-a6b7-c8d9e0f1a2b3

const possiblePaths = [];
const platform = os.platform();

// 平台适配 - macOS
if (platform === 'darwin') {
  possiblePaths.push(
    path.join(home, 'Library/Application Support/Google/Chrome/DevToolsActivePort'),
    path.join(home, 'Library/Application Support/Google/Chrome Canary/DevToolsActivePort'),
    path.join(home, 'Library/Application Support/Chromium/DevToolsActivePort'),
  );
}
```

**设计亮点**：
- 支持多种浏览器变体（Chrome、Chrome Canary、Chromium）
- 多路径备选策略（按优先级尝试）
- 提取 UUID 限定的 WebSocket 路径（安全性更高）

**第二层：常用端口扫描** (第81-88行)

```javascript
const commonPorts = [9222, 9229, 9333];
for (const port of commonPorts) {
  const ok = await checkPort(port);
  if (ok) {
    console.log(`[CDP Proxy] 扫描发现 Chrome 调试端口: ${port}`);
    return { port, wsPath: null };
  }
}
```

### 2.2 安全探测机制

**TCP 探测而非 WebSocket** (第93-102行)：

```javascript
function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, '127.0.0.1');
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 2000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}
```

**为什么用 TCP 而不是 WebSocket 探测？**
- 避免触发 Chrome 的调试授权弹窗
- 2秒超时保护，不会卡住
- 正确的资源清理（`socket.destroy()`）

## 三、WebSocket 连接管理

### 3.1 连接建立流程

**连接函数** (第114-200行)：

```javascript
async function connect() {
  // 1. 快速路径检查：已连接直接返回
  if (ws && (ws.readyState === WS.OPEN || ws.readyState === 1)) return;

  // 2. 连接复用机制：避免重复连接
  if (connectingPromise) return connectingPromise;

  // 3. 端口发现（仅首次）
  if (!chromePort) {
    const discovered = await discoverChromePort();
    if (!discovered) {
      throw new Error('Chrome 未开启远程调试端口...');
    }
    chromePort = discovered.port;
    chromeWsPath = discovered.wsPath;
  }

  // 4. 创建 WebSocket 连接
  const wsUrl = getWebSocketUrl(chromePort, chromeWsPath);
  return connectingPromise = new Promise((resolve, reject) => {
    ws = new WS(wsUrl);
    // 事件监听器注册...
  });
}
```

**三层保护**：
- **连接复用**：通过 `connectingPromise` 避免重复连接
- **状态检查**：WebSocket 状态双重检查（原生和 ws 模块兼容）
- **端口缓存**：首次发现后缓存，后续复用

### 3.2 事件处理架构

**消息路由机制** (第161-180行)：

```javascript
const onMessage = (evt) => {
  const data = typeof evt === 'string' ? evt : (evt.data || evt);
  const msg = JSON.parse(typeof data === 'string' ? data : data.toString());

  // 1. 目标会话管理
  if (msg.method === 'Target.attachedToTarget') {
    const { sessionId, targetInfo } = msg.params;
    sessions.set(targetInfo.targetId, sessionId);
  }

  // 2. 反风控：拦截调试端口探测
  if (msg.method === 'Fetch.requestPaused') {
    const { requestId, sessionId: sid } = msg.params;
    sendCDP('Fetch.failRequest', { requestId, errorReason: 'ConnectionRefused' }, sid)
      .catch(() => {});
  }

  // 3. 请求-响应匹配
  if (msg.id && pending.has(msg.id)) {
    const { resolve, timer } = pending.get(msg.id);
    clearTimeout(timer);
    pending.delete(msg.id);
    resolve(msg);
  }
};
```

**错误处理** (第144-160行)：

```javascript
const onError = (e) => {
  cleanup();
  connectingPromise = null;
  ws = null;
  chromePort = null;           // 清除缓存，下次重新发现
  chromeWsPath = null;
};

const onClose = () => {
  ws = null;
  chromePort = null;           // 重置端口缓存
  chromeWsPath = null;
  sessions.clear();
};
```

**设计模式**：
- **自动恢复**：连接断开时清除所有缓存，下次自动重新发现
- **资源清理**：使用 `cleanup()` 函数集中移除事件监听器
- **兼容性处理**：同时支持原生 WebSocket 和 ws 模块的事件 API

## 四、HTTP API 端点

### 4.1 健康检查

**GET /health** (第297-301行)：

```javascript
if (pathname === '/health') {
  const connected = ws && (ws.readyState === WS.OPEN || ws.readyState === 1);
  res.end(JSON.stringify({
    status: 'ok',
    connected,
    sessions: sessions.size,
    chromePort
  }));
  return;
}
```

### 4.2 目标管理

| 端点 | 方法 | 功能 |
|------|------|------|
| `/targets` | GET | 获取所有页面标签 |
| `/new?url=xxx` | GET | 创建新标签页 |
| `/close?target=xxx` | GET | 关闭标签页 |

**创建新标签页的智能逻辑** (第313-327行)：

```javascript
const targetUrl = q.url || 'about:blank';
const resp = await sendCDP('Target.createTarget', {
  url: targetUrl,
  background: true
});
const targetId = resp.result.targetId;

// 智能等待：非空白页面自动等待加载完成
if (targetUrl !== 'about:blank') {
  try {
    const sid = await ensureSession(targetId);
    await waitForLoad(sid);
  } catch { /* 非致命，继续 */ }
}
```

### 4.3 导航操作

| 端点 | 方法 | 功能 |
|------|------|------|
| `/navigate?target=xxx&url=yyy` | GET | 导航到指定 URL |
| `/back?target=xxx` | GET | 浏览器后退 |
| `/scroll` | GET | 滚动页面 |

**导航后自动等待** (第337-345行)：

```javascript
const sid = await ensureSession(q.target);
const resp = await sendCDP('Page.navigate', { url: q.url }, sid);
await waitForLoad(sid);  // 自动等待页面加载完成
```

### 4.4 JavaScript 执行

**POST /eval?target=xxx** (第356-373行)：

```javascript
const resp = await sendCDP('Runtime.evaluate', {
  expression: expr,
  returnByValue: true,
  awaitPromise: true,      // 自动 await Promise
}, sid);
```

### 4.5 交互操作

**两种点击模式**：

| 端点 | 方式 | 特点 |
|------|------|------|
| `/click` | JS 层面 (`el.click()`) | 简单快速，但不能触发文件对话框 |
| `/clickAt` | 浏览器级 (`Input.dispatchMouseEvent`) | 真实鼠标事件，绕过 `isTrusted` 检测 |

**`/clickAt` 的两步实现** (第412-446行)：

```
1. JS 获取元素坐标 → Runtime.evaluate
2. 发送真实鼠标事件 → Input.dispatchMouseEvent (mousePressed + mouseReleased)
```

### 4.6 文件上传

**POST /setFiles** (第450-476行)：

```javascript
// 1. 启用 DOM 域并获取文档
await sendCDP('DOM.enable', {}, sid);
const doc = await sendCDP('DOM.getDocument', {}, sid);

// 2. 查找 file input 元素
const node = await sendCDP('DOM.querySelector', {
  nodeId: doc.result.root.nodeId,
  selector: body.selector
}, sid);

// 3. 设置文件（绕过文件对话框）
await sendCDP('DOM.setFileInputFiles', {
  nodeId: node.result.nodeId,
  files: body.files
}, sid);
```

### 4.7 截图

**GET /screenshot** (第503-517行)：

```javascript
const resp = await sendCDP('Page.captureScreenshot', {
  format,       // png 或 jpeg
  quality: format === 'jpeg' ? 80 : undefined,
}, sid);

// 支持两种输出：保存到文件 或 直接返回图片数据
```

## 五、Pending Map 模式

### 5.1 核心实现

**sendCDP 函数** (第202-217行)：

```javascript
function sendCDP(method, params = {}, sessionId = null) {
  return new Promise((resolve, reject) => {
    if (!ws || (ws.readyState !== WS.OPEN && ws.readyState !== 1)) {
      return reject(new Error('WebSocket 未连接'));
    }

    const id = ++cmdId;              // 唯一命令 ID
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;

    // 30秒超时保护
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('CDP 命令超时: ' + method));
    }, 30000);

    pending.set(id, { resolve, timer });
    ws.send(JSON.stringify(msg));
  });
}
```

**数据流**：

```
[调用 sendCDP] → [生成唯一 ID] → [存入 Map] → [发送 WebSocket]
                                                    ↓
                                            [等待响应消息]
                                                    ↓
                                    [检查 msg.id 是否在 Map 中]
                                                    ↓
                                    [找到后调用 resolve(msg)]
```

**设计优势**：
- **精确匹配**：通过 ID 准确关联请求和响应（支持并发乱序）
- **超时保护**：30秒超时防止永久挂起
- **自动清理**：匹配后立即从 Map 删除

## 六、反风控策略

### 6.1 端口探测拦截

**核心机制** (第236-248行)：

```javascript
async function enablePortGuard(sessionId) {
  await sendCDP('Fetch.enable', {
    patterns: [
      { urlPattern: `http://127.0.0.1:${chromePort}/*`, requestStage: 'Request' },
      { urlPattern: `http://localhost:${chromePort}/*`, requestStage: 'Request' },
    ]
  }, sessionId);
}

// 在 onMessage 中拦截
if (msg.method === 'Fetch.requestPaused') {
  sendCDP('Fetch.failRequest', { requestId, errorReason: 'ConnectionRefused' }, sid);
}
```

**工作原理**：

```
页面 JS 试图访问 localhost:9222
        ↓
Fetch.requestPaused 事件触发
        ↓
代理返回 ConnectionRefused
        ↓
页面无法探测到调试端口的存在
```

### 6.2 真实用户手势

使用 `Input.dispatchMouseEvent` 发送浏览器级真实点击事件：
- 能触发文件对话框
- 绕过 `event.isTrusted` 检测
- 模拟真实 mousePressed + mouseReleased 序列

## 七、错误处理

### 7.1 分层错误处理

| 层级 | 策略 | 示例 |
|------|------|------|
| **全局** | uncaughtException/unhandledRejection 兜底 | 进程不崩溃 |
| **HTTP** | try-catch 包裹所有路由，返回 500 | 客户端拿到错误信息 |
| **WebSocket** | 断线时清除所有缓存 | 下次自动重连 |
| **CDP 命令** | 30秒超时 + Pending Map 清理 | 不会永久挂起 |
| **非致命操作** | `catch { /* 继续 */ }` 容忍 | 核心功能不受影响 |

### 7.2 容错策略

**非致命错误容忍** — 很多操作失败后不影响主流程：

```javascript
// 页面加载等待失败
try { await waitForLoad(sid); } catch { /* 非致命，继续 */ }

// 反风控启用失败
await sendCDP('Fetch.enable', {...}, sid).catch(() => {});
```

## 八、性能优化

### 8.1 连接复用

```javascript
// 避免重复建立连接
if (connectingPromise) return connectingPromise;
```

### 8.2 多级缓存

| 缓存 | 类型 | 用途 |
|------|------|------|
| `chromePort` / `chromeWsPath` | 变量 | 端口发现结果缓存 |
| `sessions` | Map | targetId → sessionId 映射 |
| `pending` | Map | 命令 ID → Promise 映射 |
| `portGuardedSessions` | Set | 已启用端口保护的会话 |

### 8.3 延迟初始化

只在第一次需要时才执行端口发现和 WebSocket 连接，不是启动时就连接。

## 九、兼容性处理

### 9.1 WebSocket 适配器

```javascript
let WS;
if (typeof globalThis.WebSocket !== 'undefined') {
  WS = globalThis.WebSocket;  // Node 22+
} else {
  WS = (await import('ws')).default;  // 回退到 ws 模块
}
```

### 9.2 事件 API 兼容

```javascript
if (ws.on) {
  // ws 模块：ws.on('open', handler)
  ws.on('open', onOpen);
} else {
  // 原生 WebSocket：ws.addEventListener('open', handler)
  ws.addEventListener('open', onOpen);
}
```

### 9.3 跨平台文件路径

```javascript
if (platform === 'darwin') {
  // macOS: ~/Library/Application Support/Google/Chrome/
} else if (platform === 'linux') {
  // Linux: ~/.config/google-chrome/
} else if (platform === 'win32') {
  // Windows: %LOCALAPPDATA%\Google\Chrome\User Data\
}
```

## 十、编程技巧总结

| 技巧 | 位置 | 应用场景 |
|------|------|---------|
| Promise 连接复用 | `connect()` | 避免并发重复连接 |
| 双层超时保护 | `waitForLoad()` | 超时 + 轮询双重保障 |
| 非致命容错 | 多处 `catch {}` | 核心流程不被边缘错误打断 |
| 资源自清理 | `cleanup()` | 事件监听器集中管理 |
| 兼容层抽象 | WebSocket 适配器 | 一套代码适配多种运行环境 |
| ID 自增匹配 | Pending Map | 并发乱序响应精确关联 |

## 十一、CDP 命令清单

| 命令 | 用途 |
|------|------|
| `Target.getTargets` | 获取所有页面标签 |
| `Target.createTarget` | 创建新标签页 |
| `Target.closeTarget` | 关闭标签页 |
| `Target.attachToTarget` | 附加到目标（建立会话） |
| `Page.enable` | 启用页面事件域 |
| `Page.navigate` | 导航到指定 URL |
| `Page.captureScreenshot` | 页面截图 |
| `Runtime.evaluate` | 执行 JavaScript 表达式 |
| `DOM.enable` | 启用 DOM 操作域 |
| `DOM.getDocument` | 获取文档根节点 |
| `DOM.querySelector` | 查找 DOM 元素 |
| `DOM.setFileInputFiles` | 设置文件输入框的文件 |
| `Input.dispatchMouseEvent` | 发送鼠标事件 |
| `Fetch.enable` | 启用网络拦截 |
| `Fetch.failRequest` | 拦截并拒绝请求 |
