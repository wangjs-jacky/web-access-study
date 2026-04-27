---
title: "浏览器 JS 执行能力全景：Performance API、CDP 与 DevTools 能力边界"
article_id: OBA-a7b3c9d2
date: "2026-04-28"
tags: ["Performance API", "CDP", "浏览器能力", "JS执行", "Web Access"]
---

# 浏览器 JS 执行能力全景：Performance API、CDP 与 DevTools 能力边界

> 关联教程：explorer/practices/juejin-booklet-extraction.md（掘金小册提取中 Performance API 的使用）

## 前言：这篇文章解决什么问题？

你在阅读掘金小册提取笔记时，可能产生了两个疑问：

1. **为什么用 `Performance.getEntriesByType('resource')` 获取网络请求，而不是用 Chrome DevTools 的 Network 面板？**
2. **Chrome 面板上的内容是否都能通过 JS 执行的方式实现？火焰图可以吗？还有哪些奇思妙想？**

这篇文章将系统回答这两个问题。

---

## 一、概念澄清：CDP Runtime.evaluate 只是「执行通道」

### 1.1 CDP 是什么？

CDP（Chrome DevTools Protocol）是 Chrome 暴露给外部程序的**远程控制协议**。当你打开 Chrome DevTools 面板时，DevTools 本身也是通过 CDP 协议与浏览器内核通信的。

CDP 包含多个「域」（Domain），每个域负责一类功能：

| CDP 域 | 功能 | 示例命令 |
|--------|------|---------|
| **Runtime** | 执行 JS、获取对象 | `Runtime.evaluate` |
| **Network** | 拦截/监听网络请求 | `Network.enable`, `Network.getResponseBody` |
| **Page** | 页面导航、截图 | `Page.navigate`, `Page.captureScreenshot` |
| **DOM** | 查询/修改 DOM 树 | `DOM.querySelector`, `DOM.setAttribute` |
| **Input** | 模拟鼠标/键盘 | `Input.dispatchMouseEvent` |
| **Performance** | 性能指标 | `Performance.getMetrics` |

### 1.2 Runtime.evaluate 的本质

`Runtime.evaluate` 做的事情非常简单：**在页面上下文中执行一段 JavaScript 代码，并返回结果**。

```javascript
// CDP 消息
{
  "id": 1,
  "method": "Runtime.evaluate",
  "params": {
    "expression": "document.title",  // ← 这里是要执行的 JS
    "returnByValue": true
  }
}

// 返回结果
{
  "id": 1,
  "result": {
    "result": {
      "type": "string",
      "value": "页面标题"
    }
  }
}
```

**关键理解**：
- `Runtime.evaluate` 本身**不提供任何能力**——它只是一个「执行通道」
- 所有能力来自**浏览器暴露给 JS 的 API**（DOM API、Performance API、Fetch API 等）
- 你在控制台能执行的任何 JS，通过 `Runtime.evaluate` 都能执行

### 1.3 Web Access 的 /eval 端点

Web Access 的 `cdp-proxy.mjs` 实现的 `/eval` 端点，本质上是对 `Runtime.evaluate` 的封装：

```javascript
// 用户调用
curl -s -X POST "http://localhost:3456/eval?target=ID" \
  -d 'performance.getEntriesByType("resource")'

// cdp-proxy.mjs 内部执行
await sendCDP('Runtime.evaluate', {
  expression: 'performance.getEntriesByType("resource")',
  returnByValue: true,
  awaitPromise: true,
}, sessionId);
```

所以，**`/eval` = CDP 的 Runtime.evaluate = 在页面中执行 JS**。

---

## 二、Performance API 详解

### 2.1 Performance API 是什么？

Performance API 是 W3C 标准的浏览器 API，用于**获取页面性能相关的数据**。它不是 CDP 特有的，而是所有现代浏览器都内置的 JS 接口。

核心方法：

```javascript
// 获取所有资源加载记录（网络请求）
performance.getEntriesByType('resource')

// 获取导航记录（页面加载时间线）
performance.getEntriesByType('navigation')

// 获取用户自定义标记
performance.getEntriesByType('mark')

// 获取用户自定义测量
performance.getEntriesByType('measure')
```

### 2.2 getEntriesByType('resource') 返回什么数据？

```javascript
const resources = performance.getEntriesByType('resource');

resources.forEach(r => {
  console.log({
    name: r.name,                    // 请求 URL
    type: r.initiatorType,           // 请求类型: script/link/img/xmlhttprequest/fetch
    duration: r.duration,            // 请求耗时（毫秒）
    transferSize: r.transferSize,    // 传输大小（字节）
    encodedBodySize: r.encodedBodySize,  // 响应体大小
    decodedBodySize: r.decodedBodySize,  // 解压后大小
    startTime: r.startTime,          // 请求开始时间
    responseStart: r.responseStart,  // 响应开始时间
    responseEnd: r.responseEnd,      // 响应结束时间
  });
});
```

**典型输出**：

```javascript
{
  name: "https://api.juejin.cn/booklet_api/v1/booklet/get",
  initiatorType: "xmlhttprequest",
  duration: 120.5,
  transferSize: 1024,
  encodedBodySize: 512,
  decodedBodySize: 512,
  startTime: 1500.5,
  responseStart: 1600.5,
  responseEnd: 1621.0
}
```

### 2.3 Performance API vs CDP Network

| 维度 | Performance API | CDP Network |
|------|-----------------|-------------|
| **数据来源** | 浏览器内存中的性能缓冲区 | 实时网络事件流 |
| **使用方式** | 一次查询（`getEntriesByType`） | 需先启用（`Network.enable`），再监听事件 |
| **适用场景** | 事后查询已发出的请求 | 实时捕获/拦截请求 |
| **数据精度** | 只有 URL、时间、大小 | 能拿到 request/response body、headers |
| **时机要求** | 页面加载完成后即可 | 需在请求发出前启用监听 |
| **CSP 限制** | 受页面 CSP 策略限制 | 不受页面 CSP 限制（CDP 是外部协议） |

### 2.4 为什么掘金小册提取用 Performance API？

在掘金小册提取的场景中，我们需要：
1. 打开小册页面
2. 查看页面加载时发出了哪些 API 请求
3. 分析 API 端点和请求格式

**Performance API 的优势**：
- 页面加载完成后，**一条 `eval` 命令**就能拿到所有请求的 URL
- 不需要提前启动 `Network.enable`，不需要处理事件流
- 对于「发现 API 端点」这个目标，Performance API 提供的信息已经足够（URL、请求类型）

**CDP Network 的劣势**：
- 需要先执行 `Network.enable`，然后再 `navigate`，确保捕获所有请求
- 需要监听 `Network.requestWillBeSent` / `Network.responseReceived` 等事件
- 代码复杂度更高，对于「事后查询」场景是过度设计

> [!tip] 选择原则
> - **事后查询已发出的请求** → 用 Performance API（简单、一次查询）
> - **实时捕获/拦截请求、获取请求体** → 用 CDP Network（完整数据流）

---

## 三、完整的 Performance API 类型清单

Performance API 不只有 `resource`，它支持多种类型，每种对应不同的性能数据：

```javascript
// 1. navigation - 页面导航时间线（DNS、TCP、TTFB、DOM 解析等）
performance.getEntriesByType('navigation')
// 返回: { domComplete, loadEventEnd, redirectCount, transferSize, ... }

// 2. resource - 所有资源加载记录（XHR/Fetch/Script/Stylesheet/Image...）
performance.getEntriesByType('resource')
// 返回: [{ name, initiatorType, duration, transferSize, ... }]

// 3. paint - 首次渲染时间
performance.getEntriesByType('paint')
// 返回: [{ name: 'first-paint', startTime: 800 }, { name: 'first-contentful-paint', startTime: 900 }]

// 4. measure - 用户自定义测量
performance.measure('my-operation', 'start-mark', 'end-mark')
performance.getEntriesByType('measure')

// 5. mark - 用户自定义标记
performance.mark('start-mark')
performance.getEntriesByType('mark')

// 6. longtask - 长任务（阻塞主线程超过 50ms 的任务）
performance.getEntriesByType('longtask')

// 7. layout-shift - 布局偏移（CLS 指标）
performance.getEntriesByType('layout-shift')

// 8. largest-contentful-paint - 最大内容绘制（LCP 指标）
performance.getEntriesByType('largest-contentful-paint')

// 9. event - 事件延迟（INP 指标）
performance.getEntriesByType('event')

// 10. element - 元素渲染时间
performance.getEntriesByType('element')
```

**注意**：部分类型（如 `largest-contentful-paint`、`layout-shift`）需要通过 `PerformanceObserver` 监听，不能直接用 `getEntriesByType` 获取：

```javascript
// 使用 PerformanceObserver 监听 LCP
const observer = new PerformanceObserver((list) => {
  const entries = list.getEntries();
  const lastEntry = entries[entries.length - 1];
  console.log('LCP:', lastEntry.startTime);
});
observer.observe({ entryTypes: ['largest-contentful-paint'] });
```

---

## 四、Chrome DevTools 面板 → JS API 对照表

### 4.1 完整对照表

| DevTools 面板 | 能否通过 JS 实现 | JS API | 说明 |
|--------------|----------------|--------|------|
| **Network** | 部分 | Performance API (resource timing) | 能拿到 URL/时间/大小，但拿不到 request/response body |
| **Performance (火焰图)** | 部分 | PerformanceObserver + User Timing API | 能做自定义标记，但无法获取底层 CPU profile 的原始数据 |
| **Console** | 完全 | Console API | `console.log`/`error`/`warn`/`time`/`timeEnd`/`table` |
| **Elements** | 完全 | DOM API | `querySelector`、`getComputedStyle`、`scrollIntoView` |
| **Sources** | 部分 | Function.toString()、Debugger API | 能获取函数源码，但不能断点调试 |
| **Application** | 部分 | Storage API | `localStorage`/`sessionStorage`/`IndexedDB`/`Cookie` |
| **Memory** | 部分 | performance.memory（非标准） | 只能看 JS heap 大小，无法做堆快照对比 |
| **Lighthouse** | 否 | 无 | Lighthouse 是独立工具，不是浏览器 JS API |
| **Coverage** | 否 | 无 | 无法通过 JS 获取代码覆盖率数据 |

### 4.2 详细说明

#### Network 面板

**能做的**：
```javascript
// 获取所有请求的 URL 和时间
const resources = performance.getEntriesByType('resource');
const apiRequests = resources.filter(r =>
  r.initiatorType === 'xmlhttprequest' || r.initiatorType === 'fetch'
);
apiRequests.forEach(r => {
  console.log(r.name, r.duration, r.transferSize);
});
```

**不能做的**：
- 获取 request body / response body
- 修改请求头
- 拦截请求、返回自定义响应

**需要 CDP Network 的场景**：
```javascript
// CDP 方式获取 response body
await sendCDP('Network.getResponseBody', { requestId: 'xxx' });
```

#### Performance 面板（火焰图）

**能做的**：
```javascript
// 自定义性能标记
performance.mark('operation-start');
// ... 执行操作
performance.mark('operation-end');
performance.measure('operation', 'operation-start', 'operation-end');

// 使用 PerformanceObserver 监听长任务
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    console.log('Long task:', entry.duration, 'ms');
  }
});
observer.observe({ entryTypes: ['longtask'] });
```

**不能做的**：
- 获取底层 CPU profile 的原始调用栈数据
- 分析 C++ 函数调用
- 获取内存分配的详细堆栈

**需要 CDP Profiler 的场景**：
```javascript
// CDP 方式获取 CPU profile
await sendCDP('Profiler.start');
// ... 执行操作
const profile = await sendCDP('Profiler.stop');
```

#### Memory 面板

**能做的**：
```javascript
// 仅在 Chrome 中可用（非标准 API）
if (performance.memory) {
  console.log({
    usedJSHeapSize: performance.memory.usedJSHeapSize,
    totalJSHeapSize: performance.memory.totalJSHeapSize,
    jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
  });
}
```

**不能做的**：
- 创建堆快照（Heap Snapshot）
- 对比两个快照的差异
- 分析内存泄漏的具体引用链

**需要 CDP HeapProfiler 的场景**：
```javascript
// CDP 方式获取堆快照
const snapshot = await sendCDP('HeapProfiler.takeHeapSnapshot', {
  reportProgress: false
});
```

---

## 五、eval 奇思妙想：通过 JS 能做到的所有事情

### 5.1 自动化性能检测（Core Web Vitals）

```javascript
// 监听 LCP（Largest Contentful Paint）
new PerformanceObserver((list) => {
  const entries = list.getEntries();
  const lastEntry = entries[entries.length - 1];
  console.log('LCP:', lastEntry.startTime, 'ms');
}).observe({ entryTypes: ['largest-contentful-paint'] });

// 监听 CLS（Cumulative Layout Shift）
let clsValue = 0;
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (!entry.hadRecentInput) {
      clsValue += entry.value;
    }
  }
  console.log('CLS:', clsValue);
}).observe({ entryTypes: ['layout-shift'] });

// 监听 INP（Interaction to Next Paint）
let inpValue = 0;
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    inpValue = Math.max(inpValue, entry.duration);
  }
  console.log('INP:', inpValue, 'ms');
}).observe({ entryTypes: ['event'] });
```

### 5.2 DOM 变异监控

```javascript
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.type === 'childList') {
      console.log('子节点变化:', mutation.addedNodes, mutation.removedNodes);
    } else if (mutation.type === 'attributes') {
      console.log('属性变化:', mutation.attributeName, mutation.target);
    }
  });
});

observer.observe(document.body, {
  childList: true,    // 监听子节点变化
  attributes: true,   // 监听属性变化
  subtree: true,      // 监听所有后代节点
});
```

**应用场景**：
- 检测页面是否被注入了恶意脚本
- 监控 SPA 路由变化（监听 `<title>` 变化）
- 自动保存表单内容（防止丢失）

### 5.3 网络状态探测

```javascript
if (navigator.connection) {
  console.log({
    effectiveType: navigator.connection.effectiveType,  // '4g' / '3g' / '2g'
    downlink: navigator.connection.downlink,            // 下行速度（Mbps）
    rtt: navigator.connection.rtt,                      // 往返时间（ms）
    saveData: navigator.connection.saveData,            // 是否省流量模式
  });
}

// 监听网络变化
navigator.connection.addEventListener('change', () => {
  console.log('网络类型变化:', navigator.connection.effectiveType);
});

// 在线/离线状态
window.addEventListener('online', () => console.log('网络已连接'));
window.addEventListener('offline', () => console.log('网络已断开'));
```

### 5.4 页面可访问性审计

```javascript
// 检查图片是否有 alt 属性
const imagesWithoutAlt = Array.from(document.querySelectorAll('img'))
  .filter(img => !img.alt || img.alt.trim() === '');
console.log('缺少 alt 的图片:', imagesWithoutAlt.length);

// 检查链接是否有可访问的名称
const linksWithoutText = Array.from(document.querySelectorAll('a'))
  .filter(a => !a.textContent.trim() && !a.getAttribute('aria-label'));
console.log('缺少可访问名称的链接:', linksWithoutText.length);

// 检查标题层级是否合理
const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
let lastLevel = 0;
headings.forEach(h => {
  const level = parseInt(h.tagName[1]);
  if (level > lastLevel + 1) {
    console.warn('标题层级跳跃:', `h${lastLevel} → ${h.tagName}`, h.textContent);
  }
  lastLevel = level;
});
```

### 5.5 截图（有限制）

```javascript
// 使用 html2canvas 库（需先加载）
const canvas = await html2canvas(document.body);
const imgData = canvas.toDataURL('image/png');
```

**限制**：跨域图片可能无法截取、部分 CSS 特性支持不完美、无法截取 iframe 内容。

**CDP 方式（无限制）**：
```javascript
// CDP 截图（Web Access 的 /screenshot 端点）
await sendCDP('Page.captureScreenshot', { format: 'png' });
```

### 5.6 页面行为录制

```javascript
const events = [];

['click', 'scroll', 'keydown', 'input'].forEach(eventType => {
  document.addEventListener(eventType, (e) => {
    events.push({
      type: eventType,
      timestamp: Date.now(),
      target: e.target.tagName,
    });
  });
});

// 导出为 JSON
console.log(JSON.stringify(events));
```

**应用场景**：用户行为分析、复现 bug、A/B 测试数据采集。

### 5.7 反反爬虫

```javascript
// 隐藏 webdriver 标志（CDP 启动时自动添加）
Object.defineProperty(navigator, 'webdriver', {
  get: () => false,
});

// 修改插件数量
Object.defineProperty(navigator, 'plugins', {
  get: () => [1, 2, 3, 4, 5],
});

// 修改平台
Object.defineProperty(navigator, 'platform', {
  get: () => 'Win32',
});
```

### 5.8 数据提取

```javascript
// 提取表格数据
const tables = Array.from(document.querySelectorAll('table')).map(table => ({
  headers: Array.from(table.querySelectorAll('th')).map(th => th.textContent),
  rows: Array.from(table.querySelectorAll('tr')).map(tr =>
    Array.from(tr.querySelectorAll('td')).map(td => td.textContent)
  ),
}));

// 导出为 JSON
console.log(JSON.stringify({ tables }, null, 2));
```

### 5.9 奇思妙想总结

| 能力 | 实现方式 | 限制 |
|------|---------|------|
| 性能检测（LCP/CLS/INP） | PerformanceObserver | 无 |
| DOM 监控 | MutationObserver | 无 |
| 网络探测 | Navigator API + Online/Offline | 部分浏览器不支持 |
| 可访问性审计 | DOM API（querySelector） | 只能做基础检测 |
| 截图 | html2canvas | 跨域限制、CSS 支持有限 |
| 行为录制 | 事件监听 | 需手动处理数据 |
| 反反爬虫 | 修改 navigator 属性 | 部分高级检测无法绕过 |
| 数据提取 | DOM API | 需针对每个页面编写选择器 |

---

## 六、能力边界的清晰划分

### 6.1 能力分层

```
┌─────────────────────────────────────────────────────────┐
│ 第一层：浏览器原生 JS API（所有页面都能用）                │
│ - DOM API、Performance API、Storage API                  │
│ - Navigator、Console、Fetch、WebSocket                    │
│ - MutationObserver、IntersectionObserver、ResizeObserver  │
└─────────────────────────────────────────────────────────┘
                          ↑
                    可以通过 eval 执行
                          ↑
┌─────────────────────────────────────────────────────────┐
│ 第二层：CDP 协议（需要外部程序连接）                       │
│ - Runtime.evaluate（执行 JS）                            │
│ - Network（拦截网络请求、获取 body）                      │
│ - Page（截图、PDF 导出）                                  │
│ - Profiler（CPU profile）                                │
│ - HeapProfiler（堆快照）                                  │
└─────────────────────────────────────────────────────────┘
                          ↑
                    只有 CDP 能做到
                          ↑
┌─────────────────────────────────────────────────────────┐
│ 第三层：浏览器外部工具（DevTools 面板、Lighthouse）       │
│ - Coverage（代码覆盖率）                                  │
│ - Lighthouse（综合审计）                                  │
│ - 断点调试、Sources 面板                                  │
└─────────────────────────────────────────────────────────┘
```

### 6.2 选择指南

| 任务 | 推荐方案 | 原因 |
|------|---------|------|
| 事后查询已发出的网络请求 | Performance API | 一次查询，简单直接 |
| 实时捕获/拦截网络请求 | CDP Network | 需要完整的事件流 |
| 获取 request/response body | CDP Network | JS API 无法获取 |
| 页面性能检测（LCP/CLS/INP） | PerformanceObserver | 浏览器原生 API |
| CPU 火焰图 | CDP Profiler | 需要底层调用栈数据 |
| 堆快照/内存分析 | CDP HeapProfiler | 需要完整的堆结构 |
| 截图 | CDP Page | 无跨域限制 |
| DOM 操作、数据提取 | JS API（DOM API） | 页面内执行即可 |

---

## 七、总结：回答你的三个问题

**Q1: 为什么用 Performance API 而不是 CDP Network？**

Performance API 是浏览器内置的 JS 接口，页面加载完成后所有网络请求的元数据已在内存中，一条 `eval` 命令就能读取全部数据。CDP Network 需要先订阅事件流（`Network.enable`），适合实时捕获场景。对于「事后查询已发出的请求」这个场景，Performance API 更简单直接。

**Q2: Chrome 面板上的内容都能通过 JS 实现吗？火焰图可以吗？**

- **大部分可以**：Network（URL/时间）、Console、Elements、Application（Storage）都能通过 JS API 实现
- **部分可以但有限制**：Performance 面板的火焰图——可以用 User Timing API 做自定义标记，但无法获取底层 CPU profile 的原始数据
- **不能**：Memory 面板的堆快照、Lighthouse 审计、Coverage 代码覆盖率，这些必须用 CDP 或外部工具

**Q3: 还有哪些奇思妙想？**

eval 能做的事情远不止网络请求提取——性能检测、DOM 监控、网络探测、可访问性审计、数据提取、反反爬虫、行为录制……几乎所有「在页面内能做的事情」，都可以通过 eval 程序化执行。关键是：**eval 只是执行通道，真正的能力来自浏览器暴露的 JS API**。
