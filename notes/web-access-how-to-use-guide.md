---
article_id: OBA-wa2tut8k
tags: [study-note, tutorial]
type: note
created_at: 2026-04-25
updated_at: 2026-04-25
---

# Web Access 实战教程：从安装到精通

> **本教程分两个阶段**：
> - **Phase 1**：环境配置引导（需要人工操作）
> - **Phase 2**：逐章实操教程（含实测数据）
>
> **必须严格按顺序执行**：Phase 1 全部完成后，才能进入 Phase 2。

---

# Phase 1：环境配置引导

Web Access 是一个 Claude Code Skill，安装后赋予 AI Agent 完整的联网和浏览器操作能力。下面一步步带你完成环境配置。

## 1.1 安装 Node.js 22+

Web Access 的辅助脚本需要 Node.js 22+（使用原生 WebSocket API）。

**操作步骤**：

1. 检查当前 Node.js 版本：
```bash
node --version
```

2. 如果版本低于 22，使用 nvm 安装：
```bash
nvm install 22
nvm use 22
```

**验证**：
```bash
node --version
# 输出应 >= v22.0.0
```

**完成标志**：版本号 >= 22.0.0

## 1.2 安装 web-access Skill

**操作步骤**：

1. 克隆 web-access 仓库：
```bash
git clone https://github.com/eze-is/web-access.git /tmp/web-access
```

2. 链接到 Claude Code skills 目录：
```bash
# 创建 skills 目录（如果不存在）
mkdir -p ~/.claude/skills/
# 链接（symlink 方式，方便后续更新）
ln -sf /tmp/web-access ~/.claude/skills/web-access
```

**验证**：
```bash
ls ~/.claude/skills/web-access/SKILL.md
# 应输出该文件路径
```

**完成标志**：SKILL.md 文件存在

## 1.3 开启 Chrome 远程调试

Web Access 通过 Chrome DevTools Protocol 直连你的日常 Chrome 浏览器，需要先开启远程调试。

⚠️ **这一步需要手动操作**：

1. 在 Chrome 地址栏输入：
```
chrome://inspect/#remote-debugging
```

2. 勾选 **"Allow remote debugging for this browser instance"**

3. 可能需要重启 Chrome

**验证**：
```bash
cat ~/Library/Application\ Support/Google/Chrome/DevToolsActivePort
# 应输出两行：第一行是端口号，第二行是 WebSocket 路径
```

**完成标志**：文件存在且包含端口号

## 1.4 安装 sqlite3（可选）

用于 Chrome 历史记录检索功能。不安装不影响核心 CDP 功能。

```bash
# macOS
brew install sqlite3

# 或使用系统自带版本
which sqlite3
```

**完成标志**：`which sqlite3` 有输出

## 1.5 运行环境检查

所有准备工作完成后，运行 web-access 自带的环境检查脚本：

```bash
node ~/.claude/skills/web-access/scripts/check-deps.mjs
```

脚本会依次检查：
- `node: ok` — Node.js 版本
- `chrome: ok (port XXXX)` — Chrome 调试端口
- `proxy: ready` — CDP Proxy 自动启动并连接

**完成标志**：三项全部显示 ok/ready

## 配置完成检查清单

```bash
# 逐项验证
node --version                                           # ☐ 版本 >= 22
ls ~/.claude/skills/web-access/SKILL.md                  # ☐ Skill 已安装
cat ~/Library/Application\ Support/Google/Chrome/DevToolsActivePort  # ☐ Chrome 调试已开启
node ~/.claude/skills/web-access/scripts/check-deps.mjs  # ☐ 三项全部 ok
```

**全部打勾 → 配置完成，进入实操阶段！**

---

# Phase 2：逐章实操教程

> **前置条件**：Phase 1 检查清单全部通过。
> **实测环境**：macOS 14.1 / Node.js v24.9.0 / Chrome 147 / web-access 2.5.0
> **当前状态**：✅ 全部 5 章已实测完成

---

## 第 1 章：CDP 基础操作 — Tab 生命周期

> **认证模式**：public（无需登录）
> **前置条件**：CDP Proxy 已运行

本章学习 CDP Proxy 最基本的操作：列出 tab、创建 tab、获取页面信息、执行 JavaScript、导航、关闭 tab。这些是所有后续操作的基础。

### 1.1 列出用户已打开的 tab

了解当前 Chrome 中有哪些 tab 可用：

```bash
curl -s http://localhost:3456/targets
```

**输出**（截取前 2 条）：

```json
[
    {
        "targetId": "C43159398ACB11DDD1227124594D06DC",
        "type": "page",
        "title": "jackwener/OpenCLI: Make Any Website & Tool Your CLI...",
        "url": "https://github.com/jackwener/opencli",
        "attached": false,
        "browserContextId": "E36EF8759FCD921EDFBEED95E1A589D4"
    },
    {
        "targetId": "A56145B382EDD47128828C08CE9B43AD",
        "type": "page",
        "title": "快速开始 | OpenCLI",
        "url": "https://opencli.info/docs/zh/guide/getting-started.html",
        "attached": false,
        "browserContextId": "E36EF8759FCD921EDFBEED95E1A589D4"
    }
]
```

**关键字段**：
- `targetId`：后续操作都需要这个 ID
- `title`：页面标题
- `url`：当前 URL
- `attached`：是否已绑定 CDP session

> 💡 **技巧**：加上 `| python3 -m json.tool` 可以格式化 JSON 输出。

### 1.2 创建新后台 tab

在 Chrome 中创建一个新的后台标签页，不会干扰你当前的浏览：

```bash
curl -s "http://localhost:3456/new?url=https://example.com"
```

**输出**：

```json
{"targetId":"9846B5405A771F10EB786652FBEF5244"}
```

记下这个 `targetId`，后续所有操作都要用到它。

### 1.3 获取页面信息

查看页面的基本信息（标题、URL、加载状态）：

```bash
curl -s "http://localhost:3456/info?target=9846B5405A771F10EB786652FBEF5244"
```

**输出**：

```json
{"title":"Example Domain","url":"https://example.com/","ready":"complete"}
```

- `ready: "complete"` 表示页面已完全加载
- 如果 `ready` 不是 `"complete"`，说明页面还在加载中

### 1.4 执行 JavaScript 获取页面标题

`/eval` 是最强大的端点，可以在页面中执行任意 JavaScript：

```bash
curl -s -X POST "http://localhost:3456/eval?target=9846B5405A771F10EB786652FBEF5244" -d 'document.title'
```

**输出**：

```json
{"value":"Example Domain"}
```

### 1.5 执行 JavaScript 获取页面文本

获取页面的全部可见文本：

```bash
curl -s -X POST "http://localhost:3456/eval?target=9846B5405A771F10EB786652FBEF5244" -d 'document.body.innerText'
```

**输出**：

```json
{"value":"Example Domain\n\nThis domain is for use in documentation examples without needing permission. Avoid use in operations.\n\nLearn more"}
```

### 1.6 导航到另一个 URL

在同一个 tab 中跳转到新页面：

```bash
curl -s "http://localhost:3456/navigate?target=9846B5405A771F10EB786652FBEF5244&url=https://httpbin.org/get"
```

**输出**：

```json
{"frameId":"9846B5405A771F10EB786652FBEF5244","loaderId":"C6663F8302F2D26B440ABDBFA009C7CD","isDownload":false}
```

导航后，再次获取页面内容验证：

```bash
curl -s -X POST "http://localhost:3456/eval?target=9846B5405A771F10EB786652FBEF5244" -d 'document.body.innerText'
```

**输出**：

```json
{
  "value": "{\n  \"args\": {}, \n  \"headers\": {\n    \"Accept\": \"text/html,...\",\n    \"User-Agent\": \"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ... Chrome/147.0.0.0 Safari/537.36\",\n    ...\n  }, \n  \"origin\": \"218.82.102.108\", \n  \"url\": \"https://httpbin.org/get\"\n}\n"
}
```

> 💡 可以看到 httpbin 返回了完整的请求头，包括你的真实 Chrome User-Agent，说明是浏览器在发出请求。

### 1.7 关闭 tab

任务完成后，关闭自己创建的 tab（不会影响用户原有的 tab）：

```bash
curl -s "http://localhost:3456/close?target=9846B5405A771F10EB786652FBEF5244"
```

**输出**：

```json
{"success":true}
```

### 本章小结

| 操作 | API | 方法 | 说明 |
|------|-----|------|------|
| 列出 tab | `/targets` | GET | 查看所有 Chrome 标签 |
| 创建 tab | `/new?url=URL` | GET | 后台创建新标签 |
| 页面信息 | `/info?target=ID` | GET | 标题、URL、加载状态 |
| 执行 JS | `/eval?target=ID` | POST | 任意 JavaScript 表达式 |
| 导航 | `/navigate?target=ID&url=URL` | GET | 同一 tab 内跳转 |
| 关闭 tab | `/close?target=ID` | GET | 关闭指定标签 |

---

## 第 2 章：页面交互 — 点击、滚动、截图

> **认证模式**：public（无需登录）
> **前置条件**：第 1 章完成

本章学习如何在页面中进行交互操作：点击元素、滚动页面、截图保存。

### 2.1 创建 tab 并确认加载

```bash
curl -s "http://localhost:3456/new?url=https://www.baidu.com"
```

**输出**：

```json
{"targetId":"ABB4EC2317DF6EF70DAA81833EFD416D"}
```

等待页面加载后获取标题：

```bash
curl -s -X POST "http://localhost:3456/eval?target=ABB4EC2317DF6EF70DAA81833EFD416D" -d 'document.title'
```

**输出**：

```json
{"value":"百度一下，你就知道"}
```

### 2.2 提取页面结构数据

用 `/eval` 提取页面中的结构化数据。以百度热搜为例：

```bash
curl -s -X POST "http://localhost:3456/eval?target=ABB4EC2317DF6EF70DAA81833EFD416D" \
  -d 'JSON.stringify(Array.from(document.querySelectorAll("#hotsearch-content-wrapper .hotsearch-item")).slice(0, 3).map(el => ({text: el.textContent.trim().slice(0, 20)})))'
```

**输出**：

```json
{"value":"[{\"text\":\"0习近平同通伦互致贺电\"},{\"text\":\"5什么东西既封不住也拿不走新\"},{\"text\":\"1花呗白条月付等面临重大调整热\"}]"}
```

> 💡 **技巧**：提取复杂 DOM 数据时，用 `JSON.stringify()` 包裹，确保返回可解析的字符串。

### 2.3 截图保存到文件

将当前页面截图保存到本地文件：

```bash
curl -s "http://localhost:3456/screenshot?target=ABB4EC2317DF6EF70DAA81833EFD416D&file=/tmp/baidu-home.png"
```

**输出**：

```json
{"saved":"/tmp/baidu-home.png"}
```

截图文件约 223KB，包含完整的百度首页内容。

### 2.4 滚动页面

Web Access 支持两种滚动方式：

**按像素距离滚动**：

```bash
curl -s "http://localhost:3456/scroll?target=ABB4EC2317DF6EF70DAA81833EFD416D&y=3000"
```

**输出**：

```json
{"value":"scrolled down 3000px"}
```

**滚动到页面底部**：

```bash
curl -s "http://localhost:3456/scroll?target=ABB4EC2317DF6EF70DAA81833EFD416D&direction=bottom"
```

**输出**：

```json
{"value":"scrolled to bottom"}
```

滚动后截图验证效果：

```bash
curl -s "http://localhost:3456/screenshot?target=ABB4EC2317DF6EF70DAA81833EFD416D&file=/tmp/baidu-bottom.png"
```

**输出**：

```json
{"saved":"/tmp/baidu-bottom.png"}
```

> 💡 **注意**：滚动后会自动等待 800ms，让懒加载内容有时间完成加载。

### 2.5 后退操作

在同一个 tab 中后退到上一页：

```bash
curl -s "http://localhost:3456/back?target=ABB4EC2317DF6EF70DAA81833EFD416D"
```

**输出**：

```json
{"ok":true}
```

### 2.6 提取链接（不点击）

在点击前先查看链接内容：

```bash
curl -s -X POST "http://localhost:3456/eval?target=ABB4EC2317DF6EF70DAA81833EFD416D" \
  -d 'JSON.stringify(document.querySelector("#hotsearch-content-wrapper .hotsearch-item a").href)'
```

**输出**：

```json
{"value":"\"https://www.baidu.com/s?wd=习近平同通伦互致贺电&sa=fyb_n_homepage&...\""}
```

### 2.7 关闭 tab

```bash
curl -s "http://localhost:3456/close?target=ABB4EC2317DF6EF70DAA81833EFD416D"
```

**输出**：

```json
{"success":true}
```

### 本章小结

| 操作 | API | 说明 |
|------|-----|------|
| 截图到文件 | `/screenshot?target=ID&file=PATH` | PNG 格式，直接保存到本地 |
| 按距离滚动 | `/scroll?target=ID&y=3000` | 向下滚动指定像素 |
| 滚动到底部 | `/scroll?target=ID&direction=bottom` | 支持 down/up/top/bottom |
| 后退 | `/back?target=ID` | 浏览器历史后退 |
| 提取链接 | `/eval` + `querySelector` | 点击前先确认链接内容 |

### 2.8 三种点击方式对比

Web Access 提供了三种点击方式，适用于不同场景：

| 方式 | API | 原理 | 适用场景 |
|------|-----|------|----------|
| JS 点击 | `/click` | `el.click()` | 大多数场景，简单快速 |
| 真实鼠标点击 | `/clickAt` | `Input.dispatchMouseEvent` | 需要真实用户手势（文件对话框等） |
| 文件上传 | `/setFiles` | `DOM.setFileInputFiles` | 上传文件，绕过文件选择对话框 |

**JS 点击**（最常用）：
```bash
curl -s -X POST "http://localhost:3456/click?target=TARGET_ID" -d 'button.submit'
```

**真实鼠标点击**（能触发文件对话框）：
```bash
curl -s -X POST "http://localhost:3456/clickAt?target=TARGET_ID" -d 'button.upload'
```

**文件上传**（直接设置文件路径）：
```bash
curl -s -X POST "http://localhost:3456/setFiles?target=TARGET_ID" \
  -d '{"selector":"input[type=file]","files":["/path/to/file.png"]}'
```

---

## 第 3 章：本地资源检索 — 搜索书签和历史

> **认证模式**：local（访问本地 Chrome 数据）
> **前置条件**：sqlite3 已安装

本章学习如何从本地 Chrome 中检索书签和历史记录。当用户说"我之前看过的那个 XX 文章"时，就可以用这个功能。

### 3.1 搜索书签

**单关键词搜索**：

```bash
node ~/.claude/skills/web-access/scripts/find-url.mjs github --only bookmarks --limit 5
```

**输出**：

```
[书签] 5 条
  渲染引擎-Nunjucks | https://mozilla.github.io/nunjucks/cn/templating.html | 书签栏 / 携程
  index.ts — vscode-pair-diff [GitHub] | https://github.dev/antfu/vscode-pair-diff | 书签栏 / 携程
  VirMinions/MCP-Chinese-Getting-Started-Guide | https://github.com/VirMinions/MCP-Chinese-Getting-Started-Guide | 书签栏 / 携程
  liaokongVFX/MCP-Chinese-Getting-Started-Guide | https://github.com/liaokongVFX/MCP-Chinese-Getting-Started-Guide | 书签栏 / 携程
  awesome-stars/README.md | https://github.com/jxzzlfh/awesome-stars/blob/master/README.md | 书签栏 / 携程 / AI相关
```

> 💡 **匹配逻辑**：关键词同时匹配标题（title）和 URL。`mozilla.github.io` 中包含 "github" 子串，所以也会被匹配到。

**多关键词 AND 搜索**：

```bash
node ~/.claude/skills/web-access/scripts/find-url.mjs github react --only bookmarks --limit 3
```

**输出**：

```
[书签] 0 条
```

多关键词之间是 AND 关系，必须同时出现在标题或 URL 中。

### 3.2 搜索历史记录

**最近 1 天的历史**：

```bash
node ~/.claude/skills/web-access/scripts/find-url.mjs github --only history --since 1d --limit 5
```

**输出**：

```
[历史] 5 条（按最近访问）
  sorrycc/Sokki: Feedback & issues for Sokki | https://github.com/sorrycc/Sokki | 2026-04-25 16:39:41
  sorrycc/sokki.sorrycc.com | https://github.com/sorrycc/sokki.sorrycc.com | 2026-04-25 16:38:31 | visits=2
  Your Repositories | https://github.com/wangjs-jacky?tab=repositories | 2026-04-25 16:38:23 | visits=298
  GitHub | https://github.com/ | 2026-04-25 16:37:52 | visits=288
  Repository search results | https://github.com/search?q=obsidian&type=repositories | 2026-04-25 16:37:48
```

> 💡 **原理**：Chrome 运行时会锁定 History 文件，脚本会自动复制到临时目录再查询。

**按访问次数排序**（找高频访问的网站）：

```bash
node ~/.claude/skills/web-access/scripts/find-url.mjs --only history --sort visits --limit 5
```

**输出**：

```
[历史] 5 条（按访问次数）
  Kimi AI 官网 - K2.6 上线 | https://www.kimi.com/ | 2026-04-23 15:09:56 | visits=543
  localhost:5387/#/addinformation | http://localhost:5387/#/addinformation | 2026-04-23 20:00:43 | visits=436
  localhost:5387/#/?viewspotid=17481... | http://localhost:5387/#/?viewspotid=17481... | 2026-04-23 20:00:00 | visits=399
  Your Repositories | https://github.com/wangjs-jacky?tab=repositories | 2026-04-25 16:38:23 | visits=298
  GitHub | https://github.com/ | 2026-04-25 16:37:52 | visits=288
```

**指定绝对日期**：

```bash
node ~/.claude/skills/web-access/scripts/find-url.mjs claude --only history --since 2025-04-01 --limit 3
```

**输出**：

```
[历史] 3 条（按最近访问）
  关于我们 - Claude Code中国技术服务团队 | https://www.aicodemirror.com/about-claude-code | 2026-04-25 19:27:28 | visits=2
  🚀Claudia让你丢掉Cursor告别命令行！ | https://www.bilibili.com/video/BV16D34zpEGu/ | 2026-04-25 19:27:21
  使用教程 - Claude Code共享平台 | https://www.aicodemirror.com/docs | 2026-04-25 19:27:10 | visits=3
```

### 3.3 同时搜索书签和历史

不指定 `--only` 参数时，同时搜索两个数据源：

```bash
node ~/.claude/skills/web-access/scripts/find-url.mjs github --limit 3
```

**输出**：

```
[书签] 3 条
  渲染引擎-Nunjucks | https://mozilla.github.io/nunjucks/cn/templating.html | 书签栏 / 携程
  index.ts — vscode-pair-diff [GitHub] | https://github.dev/antfu/vscode-pair-diff | 书签栏 / 携程
  VirMinions/MCP-Chinese-Getting-Started-Guide | https://github.com/VirMinions/MCP-Chinese-Getting-Started-Guide | 书签栏 / 携程

[历史] 3 条（按最近访问）
  sorrycc/Sokki: Feedback & issues for Sokki | https://github.com/sorrycc/Sokki | 2026-04-25 16:39:41
  sorrycc/sokki.sorrycc.com | https://github.com/sorrycc/sokki.sorrycc.com | 2026-04-25 16:38:31 | visits=2
  Your Repositories | https://github.com/wangjs-jacky?tab=repositories | 2026-04-25 16:38:23 | visits=298
```

### 本章小结

| 参数 | 说明 | 示例 |
|------|------|------|
| `关键词` | 空格分词，多词 AND | `github react` |
| `--only bookmarks` | 只搜索书签 | 跳过历史 |
| `--only history` | 只搜索历史 | 跳过书签 |
| `--since 1d` | 时间窗（d/h/m） | 最近 1 天 |
| `--since 2025-04-01` | 绝对日期 | 该日期之后 |
| `--sort visits` | 按访问次数排序 | 找高频网站 |
| `--limit N` | 结果数量限制 | 默认限制 |

---

## 第 4 章：高级技巧 — eval 深度用法与媒体提取

> **认证模式**：public
> **前置条件**：第 1-2 章完成

本章学习 `/eval` 的高级用法，以及媒体资源提取的最佳实践。

### 4.1 eval 返回值处理

`/eval` 的 POST body 是任意 JavaScript 表达式，返回 `{ value }` 或 `{ error }`：

- **字符串**：直接返回
- **对象/数组**：需要 `JSON.stringify()` 包裹
- **DOM 节点**：不能直接返回，需要提取属性

```bash
# ❌ 错误：DOM 节点无法序列化
curl -s -X POST "http://localhost:3456/eval?target=TARGET_ID" -d 'document.querySelector("h1")'

# ✅ 正确：提取需要的属性
curl -s -X POST "http://localhost:3456/eval?target=TARGET_ID" -d 'document.querySelector("h1").textContent'
```

### 4.2 提取页面所有链接

```bash
curl -s -X POST "http://localhost:3456/eval?target=TARGET_ID" \
  -d 'JSON.stringify(Array.from(document.querySelectorAll("a")).slice(0,10).map(a=>({text:a.textContent.trim().slice(0,30),href:a.href})))'
```

### 4.3 穿透 Shadow DOM 和 iframe

普通 `querySelector` 无法穿透 Shadow DOM 边界。`eval` 可以用递归遍历一次穿透所有层级：

```bash
# 递归遍历 DOM 树（包括 Shadow DOM）
curl -s -X POST "http://localhost:3456/eval?target=TARGET_ID" \
  -d 'JSON.stringify((function walk(node){var result=[];node=node||document.body;if(node.shadowRoot)result.push(...walk(node.shadowRoot));node.childNodes.forEach(function(c){if(c.nodeType===1)result.push(...walk(c))});return result})(document.body).length)'
```

### 4.4 媒体资源提取

提取图片 URL 的最佳实践：

```bash
# 提取所有图片 URL（确保先滚动到页面底部，触发懒加载）
curl -s "http://localhost:3456/scroll?target=TARGET_ID&direction=bottom"

# 等待滚动完成后提取
curl -s -X POST "http://localhost:3456/eval?target=TARGET_ID" \
  -d 'JSON.stringify(Array.from(document.querySelectorAll("img")).map(img=>({src:img.src, alt:img.alt})).filter(i=>i.src&&!i.src.startsWith("data:")))'
```

> 💡 **注意**：`/scroll` 到底部会触发懒加载。提取图片 URL 前必须先滚动，否则部分图片可能尚未加载。

### 4.5 视频内容获取

通过 eval 操控 `<video>` 元素：

```bash
# 获取视频信息
curl -s -X POST "http://localhost:3456/eval?target=TARGET_ID" \
  -d 'JSON.stringify({duration: document.querySelector("video")?.duration, currentTime: document.querySelector("video")?.currentTime, paused: document.querySelector("video")?.paused})'

# Seek 到特定时间点（第 30 秒）
curl -s -X POST "http://localhost:3456/eval?target=TARGET_ID" \
  -d 'document.querySelector("video").currentTime=30'

# 截取当前帧
curl -s "http://localhost:3456/screenshot?target=TARGET_ID&file=/tmp/video-frame.png"
```

---

## 第 5 章：实战模式 — 并行分治与站点经验

> **前置条件**：前 4 章完成

本章介绍两个高级模式：并行分治（多 Agent 并行调研）和站点经验积累。

### 5.1 并行分治策略

当任务包含多个独立调研目标时（如"帮我对比一下 A、B、C 三个方案"），web-access 鼓励使用子 Agent 并行执行。

**适合分治的场景**：

| 适合 | 不适合 |
|------|--------|
| 多个独立调研目标 | 目标之间有依赖关系 |
| 每个子任务量大（多页抓取） | 简单单页查询 |
| 需要 CDP 浏览器操作 | 几次搜索就能完成 |

**并行 CDP 操作的关键规则**：
- 每个子 Agent 自行创建后台 tab（`/new`）
- 所有子 Agent 共享一个 Chrome、一个 Proxy
- 通过不同 `targetId` 操作不同 tab，无竞态风险
- 任务结束后各自关闭 tab（`/close`）

**子 Agent Prompt 写法**：

```markdown
获取 https://example.com 的最新产品信息。必须加载 web-access skill 并遵循指引。
```

> ⚠️ **避免暗示手段**：用"获取""调研"等目标导向动词，而非"搜索""抓取"等手段暗示词。因为有些站点需要 CDP 直接访问，而非 WebSearch。

### 5.2 站点经验积累

操作过程中，可以按域名积累经验，供后续 session 复用。经验文件存储在 `references/site-patterns/{domain}.md`：

```markdown
---
domain: example.com
aliases: [示例, Example]
updated: 2026-04-25
---
## 平台特征
- 页面使用 SPA 架构，内容动态加载
- 需要滚动触发懒加载
- 登录后内容更完整

## 有效模式
- 搜索 URL：`https://example.com/search?q=KEYWORD`
- 文章 URL：`https://example.com/article/ID`
- 选择器：`.article-content` 获取正文

## 已知陷阱
- (2026-04-25) URL 缺少 `ref` 参数会返回 403
- (2026-04-25) 搜索结果最多显示 20 页
```

**经验的使用流程**：

```
1. check-deps.mjs 启动时列出已有站点经验文件
2. Agent 确定目标网站后，读取对应的经验文件
3. 按经验操作，如果失败则回退通用模式
4. 操作成功后，更新经验文件
```

### 5.3 四层工具选择决策树

Web Access 的核心设计是"按场景选最小代价的工具"：

```
用户请求联网
│
├─ 只需要搜索发现信息来源？
│   └─ → WebSearch（最轻，无需浏览器）
│
├─ URL 已知，需要提取特定信息？
│   └─ → WebFetch（Agent 内置工具）
│
├─ 需要原始 HTML 源码？
│   └─ → curl（获取完整 HTML）
│
├─ 文章类页面，想省 token？
│   └─ → Jina（r.jina.ai/URL，转 Markdown）
│
└─ 需要登录态？动态页面？反爬严格？
    └─ → CDP 浏览器（最重但最全能）
```

### 本章小结

| 模式 | 核心思想 | 关键规则 |
|------|----------|----------|
| 并行分治 | 多目标并行，总耗时≈单个目标 | 子 Agent 各自开 tab，共享 Proxy |
| 站点经验 | 按域名积累操作经验 | 只写经过验证的事实 |
| 工具选择 | 最小代价原则 | 能用轻量工具就不启动浏览器 |

---

## 收官：你学到了什么

| 章节 | 核心能力 | 关键 API |
|------|----------|----------|
| 第 1 章 | Tab 生命周期管理 | `/targets` `/new` `/info` `/eval` `/navigate` `/close` |
| 第 2 章 | 页面交互操作 | `/click` `/clickAt` `/setFiles` `/scroll` `/screenshot` `/back` |
| 第 3 章 | 本地资源检索 | `find-url.mjs` + 各种参数组合 |
| 第 4 章 | eval 深度用法 | JS 表达式 + `JSON.stringify` + Shadow DOM 穿透 |
| 第 5 章 | 高级实战模式 | 并行分治 + 站点经验 + 工具决策树 |

---

## 附录：命令速查表

### CDP Proxy API 速查

| 操作 | 命令 |
|------|------|
| 列出 tab | `curl -s http://localhost:3456/targets` |
| 创建 tab | `curl -s "http://localhost:3456/new?url=URL"` |
| 页面信息 | `curl -s "http://localhost:3456/info?target=ID"` |
| 执行 JS | `curl -s -X POST "http://localhost:3456/eval?target=ID" -d 'JS_CODE'` |
| JS 点击 | `curl -s -X POST "http://localhost:3456/click?target=ID" -d 'SELECTOR'` |
| 真实鼠标点击 | `curl -s -X POST "http://localhost:3456/clickAt?target=ID" -d 'SELECTOR'` |
| 文件上传 | `curl -s -X POST "http://localhost:3456/setFiles?target=ID" -d 'JSON'` |
| 滚动 | `curl -s "http://localhost:3456/scroll?target=ID&y=3000"` |
| 滚动到底 | `curl -s "http://localhost:3456/scroll?target=ID&direction=bottom"` |
| 截图 | `curl -s "http://localhost:3456/screenshot?target=ID&file=PATH"` |
| 导航 | `curl -s "http://localhost:3456/navigate?target=ID&url=URL"` |
| 后退 | `curl -s "http://localhost:3456/back?target=ID"` |
| 关闭 tab | `curl -s "http://localhost:3456/close?target=ID"` |
| 健康检查 | `curl -s http://localhost:3456/health` |

### find-url.mjs 参数速查

| 参数 | 说明 | 示例 |
|------|------|------|
| `关键词` | 空格分词 AND | `github react` |
| `--only bookmarks` | 只搜书签 | |
| `--only history` | 只搜历史 | |
| `--since 1d` | 时间窗 | `1d` `7h` `30m` |
| `--since 2025-04-01` | 绝对日期 | |
| `--sort visits` | 按访问次数 | |
| `--sort recent` | 按最近访问（默认） | |
| `--limit N` | 结果数 | 默认 20 |

### 环境管理

| 操作 | 命令 |
|------|------|
| 环境检查 | `node ~/.claude/skills/web-access/scripts/check-deps.mjs` |
| 检查 Chrome 调试端口 | `cat ~/Library/Application\ Support/Google/Chrome/DevToolsActivePort` |
| 停止 Proxy | `pkill -f cdp-proxy.mjs` |
