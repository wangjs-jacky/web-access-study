---
title: "CDP Cheat Sheet"
article_id: OBA-jzzy7wv6
date: "2026-04-27"
tags: ["cheat-sheet", "cdp", "chrome-devtools-protocol", "web-access"]
---

# CDP Cheat Sheet

> Web Access 项目中用到的 Chrome DevTools Protocol 命令速查
> 关联教程：[explorer/05-cdp-proxy-implementation.md](explorer/05-cdp-proxy-implementation.md)、[explorer/06-cdp-proxy-code-walkthrough.md](explorer/06-cdp-proxy-code-walkthrough.md)

## 一、CDP API 速查

| API | 用途 | 关键参数 | 使用场景 |
|-----|------|---------|---------|
| `Target.getTargets` | 获取所有浏览器 tab | - | 列出用户已打开的页面 |
| `Target.createTarget` | 创建新标签页 | `url`, `background: true` | 后台创建新 tab |
| `Target.closeTarget` | 关闭标签页 | `targetId` | 关闭指定 tab |
| `Target.attachToTarget` | 附加到目标建立会话 | `targetId`, `flatten: true` | 操作 tab 前必须先 attach |
| `Page.enable` | 启用 Page 域 | - | 启用页面事件监听 |
| `Page.navigate` | 导航到指定 URL | `url` | 在 tab 中打开新页面 |
| `Page.captureScreenshot` | 页面截图 | `format`, `quality` | 截取当前页面视图 |
| `Runtime.evaluate` | 执行 JavaScript | `expression`, `returnByValue: true`, `awaitPromise: true` | 在页面中执行 JS 代码 |
| `DOM.enable` | 启用 DOM 操作域 | - | 允许后续 DOM 操作 |
| `DOM.getDocument` | 获取文档根节点 | - | DOM 查询起点 |
| `DOM.querySelector` | 查找 DOM 元素 | `nodeId`, `selector` | CSS 选择器查找元素 |
| `DOM.setFileInputFiles` | 设置文件输入框的文件 | `nodeId`, `files[]` | 绕过文件对话框上传 |
| `Input.dispatchMouseEvent` | 发送鼠标事件 | `type`, `x`, `y`, `button`, `clickCount` | 模拟真实鼠标点击 |
| `Fetch.enable` | 启用网络请求拦截 | `patterns[]` | 拦截特定 URL 请求 |
| `Fetch.failRequest` | 拒绝请求 | `requestId`, `errorReason` | 反风控：拦截端口探测 |

## 二、HTTP API 端点

| 端点 | 方法 | 功能 | 参数 |
|------|------|------|------|
| `/health` | GET | 健康检查 | - |
| `/targets` | GET | 列出所有 tab | - |
| `/new` | GET | 创建新后台 tab | `url` (可选) |
| `/close` | GET | 关闭 tab | `target` (必填) |
| `/navigate` | GET | 导航到 URL | `target`, `url` |
| `/back` | GET | 浏览器后退 | `target` |
| `/info` | GET | 获取页面信息 | `target` |
| `/eval` | POST | 执行 JavaScript | `target`, body=JS 表达式 |
| `/click` | POST | JS 层面点击 | `target`, body=CSS 选择器 |
| `/clickAt` | POST | 真实鼠标点击 | `target`, body=CSS 选择器 |
| `/setFiles` | POST | 文件上传 | `target`, body={ selector, files[] } |
| `/scroll` | GET | 滚动页面 | `target`, `y`, `direction` |
| `/screenshot` | GET | 页面截图 | `target`, `file`, `format` |

## 三、操作速查

| 想做什么 | CDP API | HTTP 端点 |
|---------|---------|----------|
| 列出所有 tab | `Target.getTargets` | `GET /targets` |
| 打开网页 | `Target.createTarget` | `GET /new?url=URL` |
| 关闭 tab | `Target.closeTarget` | `GET /close?target=ID` |
| 获取页面信息 | `Runtime.evaluate` | `GET /info?target=ID` |
| 执行 JavaScript | `Runtime.evaluate` | `POST /eval?target=ID -d 'JS_CODE'` |
| JS 点击 | `Runtime.evaluate(el.click())` | `POST /click?target=ID -d 'SELECTOR'` |
| 真实鼠标点击 | `Input.dispatchMouseEvent` | `POST /clickAt?target=ID -d 'SELECTOR'` |
| 上传文件 | `DOM.setFileInputFiles` | `POST /setFiles?target=ID -d JSON` |
| 滚动页面 | `Runtime.evaluate(window.scroll*)` | `GET /scroll?target=ID&y=3000` |
| 滚动到底部 | `Runtime.evaluate(scrollTo)` | `GET /scroll?target=ID&direction=bottom` |
| 截图 | `Page.captureScreenshot` | `GET /screenshot?target=ID&file=PATH` |
| 导航到 URL | `Page.navigate` | `GET /navigate?target=ID&url=URL` |
| 后退 | `Runtime.evaluate(history.back())` | `GET /back?target=ID` |
| 拦截端口探测 | `Fetch.enable` + `Fetch.failRequest` | 自动启用 |

## 四、三种点击方式对比

| 方式 | 原理 | 速度 | 能触发文件对话框 | 适用场景 |
|------|------|------|-----------------|----------|
| **JS 点击** `/click` | `el.click()` | 快 | 否 | 大多数普通按钮交互 |
| **真实鼠标** `/clickAt` | `Input.dispatchMouseEvent` | 中 | 是 | 需要真实用户手势、绕过 isTrusted 检测 |
| **直接设置** `/setFiles` | `DOM.setFileInputFiles` | 快 | 否（绕过对话框） | 文件上传专用 |

## 五、使用示例

### 创建 tab 并等待加载
```bash
curl -s "http://localhost:3456/new?url=https://example.com"
```

### 执行 JS 获取数据
```bash
# 简单值
curl -s -X POST "http://localhost:3456/eval?target=ID" -d 'document.title'

# 复杂对象（需要 JSON.stringify）
curl -s -X POST "http://localhost:3456/eval?target=ID" \
  -d 'JSON.stringify(Array.from(document.querySelectorAll("a")).map(a=>a.href))'
```

### 滚动触发懒加载后提取图片
```bash
# 1. 滚动到底部
curl -s "http://localhost:3456/scroll?target=ID&direction=bottom"
# 2. 等待 800ms（自动）
# 3. 提取图片 URL
curl -s -X POST "http://localhost:3456/eval?target=ID" \
  -d 'JSON.stringify(Array.from(document.querySelectorAll("img")).map(img=>img.src))'
```

### 文件上传
```bash
curl -s -X POST "http://localhost:3456/setFiles?target=ID" \
  -d '{"selector":"input[type=file]","files":["/path/to/file.png"]}'
```

## 六、反风控机制

**端口探测拦截**：自动在每个 session 中启用 `Fetch.enable`，拦截页面对 `127.0.0.1:9222` 的探测请求，返回 `ConnectionRefused`，防止网站检测到 Chrome 调试端口。

## 七、技术要点

### Session 管理
- 每个 tab 有独立的 `sessionId`
- 操作 tab 前必须 `Target.attachToTarget` 获取 sessionId
- 后续所有命令都带 `sessionId` 参数

### Pending Map 模式
- 每个 CDP 命令分配唯一 ID
- Chrome 回复时通过 ID 匹配请求
- 支持并发乱序响应，30 秒超时保护

### waitForLoad 机制
- 轮询 `document.readyState` 直到 "complete"
- 500ms 轮询间隔，15s 超时
- 注意：`complete` 不等于业务内容可交互（SPA 需额外检查）
