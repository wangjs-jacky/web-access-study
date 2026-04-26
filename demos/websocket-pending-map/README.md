# WebSocket Pending Map 模式演示

## 学习目的

演示 WebSocket 异步通信中的**请求-响应匹配**模式 —— 当你通过 WebSocket 发出多条命令，响应异步返回且顺序不确定时，如何正确匹配每条响应对应的请求。

这个模式来自 [web-access](https://github.com/eze-is/web-access) 项目的 CDP Proxy 实现（`cdp-proxy.mjs:202-217`）。

## 验证的知识点

- 每条命令分配唯一递增 ID，响应中携带相同 ID 实现匹配
- 发送时将 Promise 的 resolve/reject 存入 Map，响应到达时按 ID 查找并触发
- 超时保护：setTimeout 自动 reject 并清理 Map 条目
- 并发安全：多条命令同时发送，响应乱序到达，每条都能正确匹配
- 错误处理：区分超时错误和业务错误

## 功能清单

| 功能 | 必要性 | 说明 |
|------|--------|------|
| PendingMap 类 | MUST | 核心：register() 发送 + handleResponse() 匹配 |
| 基本请求-响应 | MUST | 场景 1：单条命令的正确匹配 |
| 并发乱序响应 | MUST | 场景 2：多条命令同时发送，乱序完成 |
| 超时处理 | MUST | 场景 3：命令超时自动 reject |
| 错误响应 | SHOULD | 场景 4：服务端返回错误时正确处理 |
| 统计信息 | COULD | 发送/完成/超时/错误的计数 |

## 运行方式

```bash
cd demos/websocket-pending-map && npm install && node index.mjs
```

> 无外部依赖，`npm install` 仅生成 lock 文件。

## 核心代码（15 行实现）

```javascript
class PendingMap {
  constructor(timeout = 5000) {
    this._nextId = 0
    this._pending = new Map()  // id → { resolve, reject, timer }
    this._timeout = timeout
  }

  register(method, sendFn) {
    return new Promise((resolve, reject) => {
      const id = ++this._nextId
      const timer = setTimeout(() => {
        this._pending.delete(id)
        reject(new Error(`命令超时: ${method}`))
      }, this._timeout)
      this._pending.set(id, { resolve, reject, timer })
      sendFn(id)  // 调用方负责实际发送
    })
  }

  handleResponse(msg) {
    if (!msg.id || !this._pending.has(msg.id)) return
    const { resolve, reject, timer } = this._pending.get(msg.id)
    clearTimeout(timer)
    this._pending.delete(msg.id)
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg)
  }
}
```

## 适用场景

不仅限于 CDP/Chrome 调试。任何「发出去等回来」的异步协议都能用：

- WebSocket RPC
- JSON-RPC over WebSocket
- 消息队列的请求-响应模式
- 进程间通信（IPC）
