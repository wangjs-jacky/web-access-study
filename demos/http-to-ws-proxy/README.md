# HTTP → WebSocket 代理 Demo

## 学习目的

演示如何将 **HTTP API 请求翻译为 WebSocket 命令**，并通过 Pending Map 模式实现异步请求-响应的精确匹配。这是 web-access cdp-proxy 的核心架构。

这个模式来自 [web-access](https://github.com/eze-is/web-access) 项目的 cdp-proxy.mjs（第202-217行 sendCDP + 第288-552行 HTTP 路由）。

## 验证的知识点

- **HTTP → WebSocket 协议转换**：将简单的 HTTP 请求翻译为 WebSocket 消息
- **Pending Map 异步匹配**：发送时注册 Promise，响应时按 ID 匹配 resolve
- **并发请求处理**：多条命令同时发送，响应乱序到达，每条都能正确匹配
- **超时保护**：命令超时后自动 reject 并清理 Map 条目
- **健康检查端点**：暴露 `/health` 返回代理状态

## 功能清单

| 功能 | 必要性 | 说明 |
|------|--------|------|
| 模拟 WebSocket 服务端 | MUST | 简化版 echo server，模拟真实 WS 后端 |
| PendingMap 类 | MUST | register() 注册 + handleResponse() 匹配 |
| HTTP 路由分发 | MUST | /cmd 执行命令 + /health 健康检查 |
| 单请求验证 | MUST | 测试 1：一条命令的正确请求-响应 |
| 并发请求验证 | MUST | 测试 2：5 条命令并发发送，乱序响应正确匹配 |
| 超时处理 | SHOULD | PendingMap 超时自动 reject |

## 运行方式

```bash
cd demos/http-to-ws-proxy && node index.mjs
```

> 无需 `npm install`，无外部依赖，使用 Node.js 原生 `http` 和 `net` 模块。

## 预期输出

```
HTTP → WebSocket 代理 Demo

--- 启动模拟 WebSocket 服务端 ---
  [WS Server] 监听 127.0.0.1:19222

--- 启动 HTTP 代理 ---
  [Proxy] 监听 http://127.0.0.1:13456
  [WS Server] 客户端 #1 已连接

=== 测试 1：单请求 ===
  响应: {"id":1,"result":{"value":"[echo] Runtime.evaluate: {\"args\":true}"}}

=== 测试 2：并发 5 个请求（验证乱序响应正确匹配）===
  id=2 → [echo] Page.navigate: {"args":true}
  id=3 → [echo] Runtime.evaluate: {"args":true}
  id=4 → [echo] DOM.querySelector: {"args":true}
  id=5 → [echo] Input.click: {"args":true}
  id=6 → [echo] Target.create: {"args":true}

=== 测试 3：健康检查 ===
  响应: {"status":"ok","pending":0}

✓ 所有测试通过！Demo 完成
```

## 核心代码

### PendingMap 类（请求-响应匹配）

```javascript
class PendingMap {
  constructor(timeoutMs = 5000) {
    this._map = new Map();
    this._nextId = 0;
    this._timeoutMs = timeoutMs;
  }

  register(method, params = {}) {
    const id = ++this._nextId;
    const msg = { id, method, params };
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._map.delete(id);
        reject(new Error(`命令超时: ${method}`));
      }, this._timeoutMs);
      this._map.set(id, { resolve, timer });
    });
    return { id, msg, promise };
  }

  handleResponse(data) {
    const msg = JSON.parse(data);
    if (msg.id && this._map.has(msg.id)) {
      const { resolve, timer } = this._map.get(msg.id);
      clearTimeout(timer);
      this._map.delete(msg.id);
      resolve(msg);
    }
  }
}
```

### HTTP → WS 转发

```javascript
// HTTP 请求进来
const { msg, promise } = pending.register(method, params);
wsSocket.write(JSON.stringify(msg) + '\n');   // 转发到 WS
const result = await promise;                  // 等待响应匹配
res.end(JSON.stringify(result));               // 返回 HTTP 响应
```

## 适用场景

- HTTP → WebSocket 协议转换代理
- CDP (Chrome DevTools Protocol) 代理
- JSON-RPC over WebSocket 的 HTTP 网关
- 任何需要将同步 HTTP API 暴露为异步 WebSocket 的场景
