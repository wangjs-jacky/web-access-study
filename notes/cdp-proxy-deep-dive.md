# CDP Proxy 实现细节

> 深入分析 cdp-proxy.mjs 的完整实现：端口发现、WebSocket 管理、HTTP API、反风控机制

## 背景问题

CDP Proxy 是 web-access 的核心组件，将 AI Agent 的 curl 请求翻译成 Chrome DevTools Protocol 的 WebSocket 命令。本文深入分析其实现细节。

## 核心发现

### 1. Chrome 端口自动发现

`discoverChromePort()`（第 36-91 行）实现了零配置的端口发现：

```
读取 DevToolsActivePort 文件 → 解析端口和 WebSocket 路径 → TCP 探测验证 → 失败回退扫描常用端口
```

**关键设计**：
- **TCP 探测而非 WebSocket**：避免触发 Chrome 安全弹窗
- **第二行是 WebSocket 路径**：非 `--remote-debugging-port` 启动时，Chrome 只接受特定 UUID 路径
- **跨平台路径**：macOS/Linux/Windows 各有不同的 Chrome 数据目录

### 2. WebSocket 连接管理

`connect()`（第 114-200 行）实现连接复用和自动重连：

- `connectingPromise` 缓存进行中的连接，避免并发连接
- `onClose` 清空所有状态（端口、session），下次调用重新发现
- `onMessage` 处理三类消息：session 绑定、反风控拦截、命令响应

### 3. CDP 命令发送

`sendCDP()`（第 202-217 行）Promise 封装 + 超时保护：

```javascript
// 递增 ID + pending Map + 30 秒超时
const id = ++cmdId;
const timer = setTimeout(() => { pending.delete(id); reject(...); }, 30000);
pending.set(id, { resolve, timer });
ws.send(JSON.stringify({ id, method, params, sessionId }));
```

### 4. 反风控端口拦截

`enablePortGuard()`（第 237-248 行）拦截页面对 `127.0.0.1:{port}` 的探测：

- 使用 `Fetch.enable` 监听匹配 URL 的请求
- 拦截后返回 `ConnectionRefused`
- 只拦截调试端口，不影响其他本地服务
- `portGuardedSessions` Set 去重，避免重复启用

### 5. HTTP API 端点详解

#### `/new` — 创建 tab（第 313-327 行）
- `Target.createTarget` + `background: true`
- 非 `about:blank` 时自动 `waitForLoad`（500ms 轮询 readyState，15s 超时）

#### `/eval` — 执行 JS（第 356-373 行）
- `Runtime.evaluate` + `awaitPromise: true`
- 自动 await Promise，支持异步代码

#### `/click` — JS 层面点击（第 377-409 行）
- `querySelector` + `scrollIntoView` + `click()`
- 快速但不触发真实用户手势（不能打开文件对话框）

#### `/clickAt` — CDP 真实鼠标点击（第 412-446 行）
- 先用 JS 获取元素中心坐标，再发 `Input.dispatchMouseEvent`
- 两次调用：`mousePressed` + `mouseReleased`
- 算真实用户手势，能触发文件对话框

#### `/setFiles` — 文件上传（第 450-476 行）
- `DOM.getDocument` → `DOM.querySelector` → `DOM.setFileInputFiles`
- 绕过文件选择对话框，直接设置文件路径

#### `/scroll` — 滚动（第 479-500 行）
- 四种方向：down/up/top/bottom
- 滚动后 800ms 等待懒加载

#### `/screenshot` — 截图（第 503-517 行）
- `Page.captureScreenshot`，支持 PNG/JPEG
- 可保存到文件或直接返回

### 6. 服务器启动

- 默认端口 3456（`CDP_PROXY_PORT` 环境变量可覆盖）
- 只监听 `127.0.0.1`，避免外网访问
- 端口被占用时检测是否已有实例运行
- `uncaughtException` 捕获所有异常，防止进程崩溃

## 关键代码位置

- `cdp-proxy.mjs:36-91` — Chrome 端口自动发现
- `cdp-proxy.mjs:94-102` — TCP 探测（避免安全弹窗）
- `cdp-proxy.mjs:114-200` — WebSocket 连接管理
- `cdp-proxy.mjs:202-217` — CDP 命令发送（Promise + 超时）
- `cdp-proxy.mjs:237-248` — 反风控端口拦截
- `cdp-proxy.mjs:251-278` — waitForLoad 实现
- `cdp-proxy.mjs:288-551` — 全部 HTTP API 端点
- `cdp-proxy.mjs:564-591` — 服务器启动逻辑

## 可复用模式

1. **TCP 探测代替 WebSocket 连接**：验证端口可用性时不触发安全弹窗
2. **connectingPromise 防并发连接**：多请求共享同一个连接过程
3. **pending Map + 递增 ID**：异步命令-响应匹配的标准模式
4. **Fetch.enable 反风控**：精确拦截特定 URL 模式的请求
5. **三步点击策略**：JS click（快）→ CDP 真实鼠标（真实手势）→ setFiles（绕过对话框）
