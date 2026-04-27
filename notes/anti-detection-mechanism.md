---
title: "浏览器自动化检测与反风控机制"
article_id: OBA-k3n7w2p5
date: "2026-04-27"
tags: ["anti-detection", "cdp", "browser-automation", "stealth", "wind-control"]
---

# 浏览器自动化检测与反风控机制

> 关联教程：explorer/05-cdp-proxy-implementation.md、explorer/09-skill-prompt-engineering.md

## 问题

终端中每次都会看到提示："部分站点对浏览器自动化操作检测严格，存在账号封禁风险。已内置防护措施但无法完全避免"。两个问题：
1. 浏览器是如何识别到自动化操作的？
2. web-access 项目做了哪些防控措施？

## 一、浏览器如何识别自动化操作

### 1.1 navigator.webdriver

**原理**：`navigator.webdriver` 是 WebDriver 标准属性，当浏览器通过 Selenium、Puppeteer、Playwright 等自动化工具控制时，该属性值为 `true`。正常用户浏览器该属性为 `undefined` 或 `false`。这是最直接、最基础的自动化检测方式。

```javascript
// 网站检测代码示例
if (navigator.webdriver === true) {
  console.log('检测到自动化控制');
}
```

**web-access 的应对**：项目使用**真实用户 Chrome 浏览器**而非 headless 模式，天然避免了此属性被设置。

### 1.2 CDP 连接检测

**原理**：当浏览器通过 CDP 连接时，存在多种可检测特征：

1. **调试端口探测**：自动化工具常使用 `--remote-debugging-port=9222` 启动参数，网站可通过 JS 尝试连接 `http://127.0.0.1:9222/json` 验证是否存在调试端口
2. **CDP 域特征**：`window.chrome` 对象的特殊属性、`window.chrome.runtime` 的存在性
3. **WebSocket 连接特征**：检测是否存在活跃的 DevTools WebSocket 连接

**web-access 的应对**：cdp-proxy.mjs 实现了**端口探测拦截**（第 169-248 行）：

```javascript
// 拦截页面对 Chrome 调试端口的探测请求（反风控）
if (msg.method === 'Fetch.requestPaused') {
  const { requestId, sessionId: sid } = msg.params;
  sendCDP('Fetch.failRequest', { requestId, errorReason: 'ConnectionRefused' }, sid).catch(() => {});
}

// 启用端口拦截
async function enablePortGuard(sessionId) {
  if (!chromePort || portGuardedSessions.has(sessionId)) return;
  try {
    await sendCDP('Fetch.enable', {
      patterns: [
        { urlPattern: `http://127.0.0.1:${chromePort}/*`, requestStage: 'Request' },
        { urlPattern: `http://localhost:${chromePort}/*`, requestStage: 'Request' },
      ]
    }, sessionId);
    portGuardedSessions.add(sessionId);
  } catch { /* Fetch 域启用失败不影响主流程 */ }
}
```

**技术要点**：
- 使用 CDP `Fetch.enable` 域拦截网络请求
- 拦截所有对 `127.0.0.1:{chromePort}` 的请求
- 返回 `ConnectionRefused` 错误，使网站探测失败
- 只拦截调试端口，不影响其他本地服务

### 1.3 JavaScript 执行环境差异

**原理**：自动化浏览器与真实浏览器在 JS 执行环境上存在差异：

| 检测点 | 说明 |
|--------|------|
| `navigator.plugins.length` | headless 模式下通常为 0 |
| `navigator.languages` | 可能缺失或异常 |
| Canvas/WebGL 指纹 | Headless Chrome 的渲染结果与有头模式不同 |
| AudioContext 指纹 | 音频上下文指纹在自动化环境下特征明显 |
| Permission API | 某些权限在自动化环境下默认值不同 |

**web-access 的应对**：使用真实用户 Chrome，所有插件、扩展、浏览器指纹均与真实用户一致，**无需任何 JavaScript 层面的伪装**。

### 1.4 事件触发模式差异

**原理**：自动化操作触发的事件与真实用户操作存在差异：

1. **isTrusted 属性**：真实用户操作触发 `event.isTrusted === true`；JS 直接调用 `el.click()` 触发 `isTrusted === false`
2. **事件序列完整性**：真实鼠标操作包含 `mousemove → mousedown → mouseup → click`，简单 `el.click()` 只触发 click
3. **时间间隔特征**：自动化操作时间间隔过于精确，人类操作存在随机性

**web-access 提供两种点击方式**：

| 方式 | API | 原理 | isTrusted | 适用场景 |
|------|-----|------|-----------|----------|
| JS 点击 | `/click` | `document.querySelector(selector).click()` | `false` | 大多数常规点击 |
| CDP 真实点击 | `/clickAt` | `Input.dispatchMouseEvent` 发送浏览器级事件 | `true` | 需要绕过检测、触发文件对话框 |

`/clickAt` 的核心代码（cdp-proxy.mjs 第 412-446 行）：

```javascript
// 1. 获取元素坐标
const coord = await sendCDP('Runtime.evaluate', { expression: js }, sid);

// 2. 发送浏览器级鼠标事件（完整事件序列）
await sendCDP('Input.dispatchMouseEvent', {
  type: 'mousePressed', x: coord.x, y: coord.y, button: 'left', clickCount: 1
}, sid);
await sendCDP('Input.dispatchMouseEvent', {
  type: 'mouseReleased', x: coord.x, y: coord.y, button: 'left', clickCount: 1
}, sid);
```

### 1.5 其他检测机制

| 检测机制 | 说明 | web-access 应对 |
|----------|------|----------------|
| Chrome 扩展检测 | 通过 `window.chrome.runtime` 检测 | 真实浏览器，扩展环境一致 |
| 用户行为模式 | 鼠标轨迹、操作频率、页面停留时间 | Prompt 引导拟人化操作 |
| 网络层指纹 | TLS 指纹、HTTP/2 指纹、请求头顺序 | 真实浏览器指纹一致 |
| 字体/渲染指纹 | Canvas 字体渲染差异 | 真实渲染环境一致 |
| WebRTC 泄露 | 获取真实 IP 检测代理 | 不涉及网络层修改 |

## 二、web-access 项目的反风控措施

### 2.1 SKILL.md 中的 Prompt 层防护

#### (1) 风险提示（第 29-31 行）

```markdown
温馨提示：部分站点对浏览器自动化操作检测严格，存在账号封禁风险。
已内置防护措施但无法完全避免，Agent 继续操作即视为接受。
```

#### (2) 拟人化操作指引（第 33-46 行）

```markdown
**像人一样思考，兼顾高效与适应性的完成任务。**
执行任务时不会过度依赖固有印象所规划的步骤，而是带着目标进入，
边看边判断，遇到阻碍就解决，发现内容不够就深入——
全程围绕「我要达成什么」做决策。
```

**反检测意义**：避免"机器人式"的固定流程，每次操作都根据实际结果动态决策。

#### (3) 程序化 vs GUI 交互策略（第 81-90 行）

```markdown
- **程序化方式**（构造 URL 直接导航、eval 操作 DOM）：
  成功时速度快、精确，但对网站来说不是正常用户行为，可能触发反爬机制。
- **GUI 交互**（点击按钮、填写输入框、滚动浏览）：
  GUI 是为人设计的，网站不会限制正常的 UI 操作，确定性最高。
根据对目标平台的了解来灵活选择方式。
```

**反检测策略**：优先使用 GUI 交互应对严格检测，失败时切换。

#### (4) 风控信号识别（第 164-165 行）

```markdown
- 短时间内密集打开大量页面（如批量 /new）可能触发网站的反爬风控。
- "内容不存在"等提示不一定反映真实状态，也可能是触发反爬。
```

#### (5) 子 Agent 去暗示化 Prompt（第 200 行）

```markdown
避免用暗示具体手段的动词（「搜索」「抓取」「爬取」），
改为描述目标（「获取」「调研」「了解」）。
```

### 2.2 架构层的天然优势

**核心设计**（SKILL.md 第 94 行）：`通过 CDP Proxy 直连用户日常 Chrome，天然携带登录态，无需启动独立浏览器。`

**这意味着**：
- 无需 headless 模式 → 不需要 `--disable-blink-features=AutomationControlled` 等参数
- 无需修改浏览器指纹 → 完全复用用户真实环境
- 自然携带所有用户特征 → 插件、扩展、历史记录、Cookie

### 2.3 CDP 层面的反检测

| 措施 | 代码位置 | 原理 |
|------|----------|------|
| **端口探测拦截** | cdp-proxy.mjs `enablePortGuard()` | Fetch.enable 拦截调试端口请求 |
| **真实鼠标事件** | cdp-proxy.mjs `/clickAt` 端点 | Input.dispatchMouseEvent 发送浏览器级事件 |
| **文件上传绕过** | cdp-proxy.mjs `/setFiles` 端点 | DOM.setFileInputFiles 直接设置文件 |
| **滚动模拟** | cdp-proxy.mjs `/scroll` 端点 | 滚动后等待 800ms，模拟真实浏览速度 |

### 2.4 行为层面的防护

**站点内链接优先策略**（SKILL.md 第 90 行）：

```markdown
站点内交互产生的链接是可靠的：通过用户视角中的可交互单元（卡片、条目、按钮）
进行的站点内交互，自然到达的 URL 天然携带平台所需的完整上下文。
```

**站点经验积累**（SKILL.md 第 225-249 行）：按域名存储操作经验到 `references/site-patterns/`，避免重复触发已知风控。

## 三、总结

### 检测 vs 反检测对照表

| 检测机制 | web-access 应对 | 效果 |
|----------|----------------|------|
| navigator.webdriver | 使用真实 Chrome | ✅ 完全规避 |
| CDP 调试端口探测 | Fetch.enable 拦截 | ✅ 主动防御 |
| JS 执行环境差异 | 复用真实浏览器 | ✅ 完全规避 |
| 事件 isTrusted | /clickAt 真实鼠标事件 | ✅ 部分应对 |
| 用户行为模式 | Prompt 拟人化引导 | ⚠️ 依赖 AI 理解 |
| 网络层指纹 | 真实浏览器 | ✅ 完全一致 |
| 字体/渲染指纹 | 真实浏览器 | ✅ 完全一致 |

### 核心设计理念：真实浏览器 + 主动防御

```
┌─────────────────────────────────────┐
│  Prompt 层：拟人化操作策略引导       │
├─────────────────────────────────────┤
│  架构层：真实浏览器 + CDP Proxy     │
├─────────────────────────────────────┤
│  CDP 层：端口拦截 + 真实鼠标事件    │
├─────────────────────────────────────┤
│  行为层：GUI 交互优先，动态调整     │
└─────────────────────────────────────┘
```

**关键洞察**：web-access 避免了传统"猫鼠游戏"式的对抗（不需要持续更新反检测代码），而是通过"使用真实浏览器"这个架构选择从根本上规避了大部分检测手段。这是一种更为优雅和可持续的方案。

### 与传统方案对比

| 对比维度 | 传统方案（Selenium/Puppeteer） | web-access |
|----------|-------------------------------|------------|
| 浏览器模式 | Headless Chrome | 用户真实 Chrome |
| navigator.webdriver | 需 CDP 命令隐藏 | 天然 undefined |
| 环境指纹 | 需各种补丁伪装 | 完全一致 |
| CDP 探测 | 容易被检测 | 主动拦截 |
| 维护成本 | 需跟随浏览器更新 | 几乎无需维护 |
| 检测难度 | 中等 | 极高 |

## 关键发现

1. **"真实浏览器"是最大的反检测武器**：架构选择比代码技巧更有效，使用用户日常 Chrome 从根本上消除了大部分指纹差异
2. **唯一需要主动防御的是 CDP 调试端口探测**：通过 `Fetch.enable` 拦截实现，这是代码层面唯一的反检测措施
3. **Prompt 层的拟人化引导是"软性防护"**：通过引导 AI 像人一样操作来降低行为模式风险，但效果取决于 AI 对 Prompt 的理解程度
