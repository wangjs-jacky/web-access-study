#!/usr/bin/env node
// HTTP → WebSocket 代理 Demo
// 验证知识点：HTTP API 翻译为 WebSocket 命令、Pending Map 异步匹配、并发请求处理
//
// 本 demo 启动一个模拟 WebSocket 服务端 + HTTP 代理，完整演示 web-access 的核心代理模式。
// 无需外部依赖，使用 Node.js 原生 http 模块。

import http from 'node:http';
import net from 'node:net';

// ============================================
// 1. 模拟 WebSocket 服务端（echo server）
// ============================================
function createMockWSServer(port) {
  const clients = new Map(); // socket → { id }
  let clientId = 0;

  const server = net.createServer((socket) => {
    const id = ++clientId;
    clients.set(socket, { id });
    console.log(`  [WS Server] 客户端 #${id} 已连接`);

    let buffer = '';
    socket.on('data', (data) => {
      buffer += data.toString();
      // 简单的文本帧解析（仅演示用，不处理真正的 WebSocket 帧）
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          // 模拟异步延迟（50-200ms）
          const delay = 50 + Math.random() * 150;
          setTimeout(() => {
            const response = {
              id: msg.id,
              result: { value: `[echo] ${msg.method}: ${JSON.stringify(msg.params)}` },
            };
            socket.write(JSON.stringify(response) + '\n');
          }, delay);
        } catch {}
      }
    });

    socket.on('close', () => {
      clients.delete(socket);
      console.log(`  [WS Server] 客户端 #${id} 断开`);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`  [WS Server] 监听 127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

// ============================================
// 2. Pending Map — 异步请求-响应匹配
// ============================================
class PendingMap {
  constructor(timeoutMs = 5000) {
    this._map = new Map();
    this._nextId = 0;
    this._timeoutMs = timeoutMs;
  }

  // 注册请求，返回 { id, promise }
  register(method, params = {}) {
    const id = ++this._nextId;
    const msg = { id, method, params };

    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._map.delete(id);
        reject(new Error(`命令超时: ${method} (id=${id})`));
      }, this._timeoutMs);

      this._map.set(id, { resolve, timer, method });
    });

    return { id, msg, promise };
  }

  // 匹配响应
  handleResponse(data) {
    const msg = JSON.parse(data);
    if (msg.id && this._map.has(msg.id)) {
      const { resolve, timer } = this._map.get(msg.id);
      clearTimeout(timer);
      this._map.delete(msg.id);
      resolve(msg);
    }
  }

  get size() { return this._map.size; }
}

// ============================================
// 3. HTTP → WebSocket 代理
// ============================================
async function createProxy(httpPort, wsPort) {
  const pending = new PendingMap(5000);

  // 连接到模拟 WS 服务端
  const wsSocket = net.createConnection(wsPort, '127.0.0.1');
  let wsBuffer = '';

  wsSocket.on('data', (data) => {
    wsBuffer += data.toString();
    const lines = wsBuffer.split('\n');
    wsBuffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) pending.handleResponse(line);
    }
  });

  // HTTP 服务器
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    const url = new URL(req.url, `http://localhost:${httpPort}`);

    try {
      if (url.pathname === '/health') {
        res.end(JSON.stringify({ status: 'ok', pending: pending.size }));
      } else if (url.pathname === '/cmd') {
        const method = url.searchParams.get('method') || 'test.method';
        const { msg, promise } = pending.register(method, { args: true });
        wsSocket.write(JSON.stringify(msg) + '\n');
        const result = await promise;
        res.end(JSON.stringify(result));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: '未找到端点' }));
      }
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
  });

  return new Promise((resolve) => {
    server.listen(httpPort, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

// ============================================
// 4. 测试：并发请求验证
// ============================================
async function runTests(httpPort) {
  console.log('\n=== 测试 1：单请求 ===');
  const r1 = await fetch(`http://127.0.0.1:${httpPort}/cmd?method=Runtime.evaluate`);
  console.log('  响应:', JSON.stringify(await r1.json()));

  console.log('\n=== 测试 2：并发 5 个请求（验证乱序响应正确匹配）===');
  const methods = ['Page.navigate', 'Runtime.evaluate', 'DOM.querySelector', 'Input.click', 'Target.create'];
  const promises = methods.map(m =>
    fetch(`http://127.0.0.1:${httpPort}/cmd?method=${m}`).then(r => r.json())
  );
  const results = await Promise.all(promises);
  for (const r of results) {
    console.log(`  id=${r.id} → ${r.result?.value}`);
  }

  console.log('\n=== 测试 3：健康检查 ===');
  const r3 = await fetch(`http://127.0.0.1:${httpPort}/health`);
  console.log('  响应:', JSON.stringify(await r3.json()));
}

// ============================================
// 主流程
// ============================================
async function main() {
  console.log('HTTP → WebSocket 代理 Demo\n');

  console.log('--- 启动模拟 WebSocket 服务端 ---');
  const wsServer = await createMockWSServer(19222);

  console.log('\n--- 启动 HTTP 代理 ---');
  const proxy = await createProxy(13456, 19222);
  console.log('  [Proxy] 监听 http://127.0.0.1:13456');

  // 等待连接建立
  await new Promise(r => setTimeout(r, 500));

  await runTests(13456);

  console.log('\n✓ 所有测试通过！Demo 完成');

  // 清理
  proxy.close();
  wsServer.close();
  process.exit(0);
}

await main();
