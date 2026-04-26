# Chrome 调试端口发现 Demo

## 学习目的

演示如何**多层回退地发现 Chrome 调试端口** —— 这是浏览器自动化的第一步，也是 cdp-proxy.mjs 的启动前提。

这个模式来自 [web-access](https://github.com/eze-is/web-access) 项目的 cdp-proxy.mjs（第36-102行）和 check-deps.mjs（第29-83行）。

## 验证的知识点

- **DevToolsActivePort 文件解析**：Chrome 启动时写入调试端口和 WebSocket 路径
- **跨平台路径适配**：macOS / Linux / Windows 不同的 Chrome 数据目录
- **TCP 端口探测**：用 `net.Socket` 轻量级探测，避免触发 Chrome 授权弹窗
- **两级回退策略**：文件发现 → 端口扫描，从高确定性到低确定性
- **UUID 限定的 WebSocket 路径**：非显式 `--remote-debugging-port` 启动时，Chrome 只接受带 UUID 的路径

## 功能清单

| 功能 | 必要性 | 说明 |
|------|--------|------|
| 跨平台路径映射 | MUST | macOS/Linux/Windows 三端支持 |
| DevToolsActivePort 文件读取 | MUST | 第一层：解析端口和 wsPath |
| TCP 端口探测 | MUST | 用 `net.createConnection` 避免安全弹窗 |
| 常见端口扫描 | MUST | 第二层：回退扫描 9222/9229/9333 |
| WebSocket URL 构建 | SHOULD | 根据是否有 wsPath 选择不同 URL 格式 |
| 过期文件检测 | COULD | 文件存在但端口无响应时的处理 |

## 运行方式

```bash
cd demos/chrome-port-discovery && node index.mjs
```

> 无需 `npm install`，无外部依赖，使用 Node.js 原生模块。

## 预期输出

```
Chrome 调试端口发现 Demo
平台: darwin (arm64)

=== 第一层：DevToolsActivePort 文件发现 ===
  ✓ 文件: .../DevToolsActivePort
    端口: 9222
    WebSocket 路径: /devtools/browser/xxx-xxx
    TCP 探测: 端口开放

★ 发现成功（来源: 文件）: 端口 9222
  WebSocket URL: ws://127.0.0.1:9222/devtools/browser/xxx-xxx
```

## 核心代码（两级回退模式）

```javascript
// 第一层：从 DevToolsActivePort 文件读取
for (const filePath of activePortFiles()) {
  const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
  const port = parseInt(lines[0], 10);
  if (port > 0 && port < 65536 && await checkPort(port)) {
    return { port, wsPath: lines[1] || null };
  }
}

// 第二层：扫描常见端口
for (const port of [9222, 9229, 9333]) {
  if (await checkPort(port)) return { port, wsPath: null };
}
```

## 适用场景

任何需要连接 Chrome DevTools 的自动化场景：

- Puppeteer / Playwright 的浏览器连接
- CDP 调试代理（如 web-access 的 cdp-proxy）
- Chrome 扩展的后台脚本调试
- 自动化测试框架的浏览器管理
