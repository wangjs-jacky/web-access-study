---
title: "实战演练：掘金小册全文提取 —— API 逆向 + 图片本地化 + Skill 封装"
article_id: OBA-40z2i0u7
date: "2026-04-28"
source_notes:
  - "explorer/practices/bilibili-video-extraction.md"
tags: ["掘金", "API逆向", "图片提取", "Skill封装", "ob-collect"]
---

# 实战演练：掘金小册全文提取

> 本文记录了从「想提取掘金小册内容」到「完成 Skill 封装」的完整过程。与 B 站视频提取（CDP 浏览器模式）不同，这次走的是 **API 逆向**路线：分析页面请求 → 找到公开 API → 编写提取脚本 → 批量下载 → 封装到 ob-collect skill。整个过程不需要浏览器，不需要登录（免费小册），比 CDP 模式高效得多。

## 一、任务目标

把掘金小册 [Node.js 入门教程](https://juejin.cn/book/7304230207953567755) 的全部 28 个章节 + 所有图片提取到本地 Obsidian 仓库。

**额外目标**：将提取能力封装到 `ob-collect` skill 中，以后任何掘金小册 URL 都能用 `ob-collect` 一键采集。

**预期产出**：

```
raw/notes/juejin/nodejs-intro-tutorial/
├── README.md              # 小册索引
├── 01-小册介绍.md          # 29 篇章节
├── 02-在线运行Node.js.md
├── ...
├── 29-进阶内容推荐.md
└── images/                # 321 张图片
    ├── cover.png
    ├── 01-1.image
    └── ...
```

## 二、方案选型

面对「提取网页内容」这个需求，通常有三条路：

| 方案 | 适用场景 | 优势 | 劣势 |
|------|---------|------|------|
| **CDP 浏览器模式** | SPA、需要登录、有反爬 | 天然携带登录态，能处理 JS 渲染 | 速度慢，依赖 Chrome |
| **API 逆向** | 有公开/半公开 API | 速度快，数据结构清晰 | 需要分析 API |
| **静态抓取** | SSR 页面 | 简单直接 | 处理不了 SPA |

掘金是 SPA 架构，页面内容由 JavaScript 动态加载。如果走 CDP 路线（像 B 站提取那样），需要打开浏览器、导航、逐页提取——对于 28 个章节来说太慢了。

> [!tip] 选型思路：先看 API
> 遇到 SPA 网站时，不要急着上浏览器。**先打开 DevTools Network 面板**，观察页面加载时发了哪些请求。很多 SPA 背后都有公开或半公开的 API，直接调 API 比浏览器自动化高效几个数量级。

**决策**：先尝试 API 逆向路线。

> [!question] 为什么 B 站视频提取没走 API 逆向？
> 读者可能会问：既然 API 逆向这么高效，B 站提取时为什么不用？
>
> 两个原因：
> 1. **B 站 API 有复杂的签名机制**（如 wbi 签名），不是简单的 POST + JSON 就能调通的，逆向成本高
> 2. **Web Access 本身不会主动做 API 逆向**——它的核心能力是 CDP 浏览器模式（打开页面、执行 JS、提取 DOM）。这次掘金小册的 API 逆向是**研究者手动分析**的结果，不是 Web Access 自动完成的
>
> 简单说：Web Access 给了你"用 CDP 操控浏览器"的能力，但"先看看有没有公开 API"这个思路，是人的判断。

## 三、API 逆向过程

### 3.1 发现 API

整个 API 逆向过程由 **Web Access 自动完成**——用户只需要给出掘金小册的 URL 和提取目标，Web Access 通过 CDP（Chrome DevTools Protocol）自动操控浏览器，观察网络请求，分析 API 结构。

Web Access 自动发现的关键请求：

```
POST https://api.juejin.cn/booklet_api/v1/booklet/get
POST https://api.juejin.cn/booklet_api/v1/section/get
```

> [!question] Web Access 是怎么自动完成 API 逆向的？
> 用户没有手动打开 DevTools、没有手动筛选 Network 面板——这些都是 Web Access 通过 CDP 协议自动执行的。
>
> | 问题 | 回答 |
> |------|------|
> | 谁完成的？ | Web Access（通过 cdp-proxy.mjs 连接 Chrome 的 CDP 端口，程序化操控浏览器） |
> | 具体机制？ | Web Access 通过 `/eval` 端点执行 JS（如 `performance.getEntriesByType("resource")`），获取页面加载时发出的所有 API 请求 URL，再分析请求/响应结构。不需要 CDP 的 `Network.enable`，浏览器自身的 Performance API 就提供了同等信息 |
> | 和 Chrome DevTools 面板的关系？ | DevTools 面板是给人用的可视化界面。Web Access 不打开 DevTools 面板，而是直接通过 CDP 协议获取同等的信息（Network 数据、请求头、响应体等） |
> | 用户做了什么？ | 用户只提供了 URL 和目标描述（"提取小册内容"），其余分析全部自动完成 |
> | 怎么验证？ | 3.4 节的 curl 命令是 Web Access 分析结果后生成的验证方式——用它确认 API 确实可以无认证调用 |

> [!example] 动手验证：用 curl 复现 Web Access 的 API 逆向过程
>
> 以下命令可以让你亲自验证"通过 CDP 捕获网络请求"这件事。确保 CDP Proxy 已启动（`http://localhost:3456`）。
>
> **步骤 1：打开掘金小册页面**
> ```bash
> curl -s "http://localhost:3456/new?url=https://juejin.cn/book/7304230207953567755" | python3 -m json.tool
> ```
> 返回 `targetId`，记下来用于后续操作。
>
> **步骤 2：等待页面加载完成，然后用 `/eval` 读取已加载的网络请求**
> ```bash
> # 替换 TARGET_ID 为步骤 1 返回的 targetId
> curl -s -X POST "http://localhost:3456/eval?target=TARGET_ID" \
>   -d 'JSON.stringify(
>     performance.getEntriesByType("resource")
>       .filter(e => e.name.includes("api.juejin") || e.name.includes("booklet"))
>       .map(e => ({ name: e.name, type: e.initiatorType, duration: Math.round(e.duration) }))
>   )'
> ```
> 你会看到类似输出：
> ```json
> [{"name":"https://api.juejin.cn/booklet_api/v1/booklet/get","type":"xmlhttprequest","duration":120},
>  {"name":"https://api.juejin.cn/booklet_api/v1/section/get","type":"xmlhttprequest","duration":85}]
> ```
> **这就是 Web Access 看到的东西**——通过 `/eval` 执行 JS 的 `performance.getEntriesByType("resource")`，拿到页面加载时发出的所有 API 请求 URL。
>
> **步骤 3：用 `/eval` 进一步读取 API 响应内容**
> ```bash
> curl -s -X POST "http://localhost:3456/eval?target=TARGET_ID" \
>   -d 'document.querySelector("title")?.textContent'
> ```
> 返回页面标题，确认页面确实已加载。
>
> **步骤 4：直接用 curl 调用 API 验证（3.4 节的方式）**
> ```bash
> curl -s -X POST 'https://api.juejin.cn/booklet_api/v1/booklet/get' \
>   -H 'Content-Type: application/json' \
>   -H 'Origin: https://juejin.cn' \
>   -d '{"booklet_id":"7304230207953567755"}' | python3 -m json.tool
> ```
> 返回小册的完整 JSON 数据。
>
> **总结**：Web Access 就是靠步骤 2 的 `performance.getEntriesByType("resource")` 发现 API 端点的——不需要手动打开 DevTools，一条 `/eval` 命令就能拿到所有网络请求的 URL。

> [!tip] URL 中的线索
> API 路径 `booklet_api/v1/booklet/get` 非常 RESTful，一看就知道：
> - `booklet_api` → 小册相关 API
> - `v1` → 版本号
> - `booklet/get` → 获取小册信息
> - `section/get` → 获取章节内容
>
> 这种命名规范的 API，通常请求/响应结构也很规整。

> [!info] 为什么用 Performance API 而不是 CDP Network？
> CDP 的 Network 域需要先订阅事件流（`Network.enable`），然后持续监听网络事件——适合「实时捕获」场景。而 Performance API 是浏览器内置的 JS 接口，页面加载完成后所有网络请求的元数据（URL、时间、大小等）已在内存中，一条 `performance.getEntriesByType("resource")` 命令就能读取全部数据。对于「事后查询已发出的请求」这个场景，Performance API 更简单直接——无需启动监听，无需处理事件流，一次查询即可拿到所有信息。
>
> 详见专题笔记：[浏览器 JS 执行能力全景](../../notes/browser-js-execution-capabilities.md)

### 3.2 分析请求结构

**获取小册信息**：

```json
// POST https://api.juejin.cn/booklet_api/v1/booklet/get
// Request Body:
{ "booklet_id": "7304230207953567755" }

// Response:
{
  "err_no": 0,
  "data": {
    "booklet": {
      "base_info": {
        "title": "Node.js 入门教程",
        "section_count": 28,
        "section_ids": "id1|id2|id3|...",  // 关键字段！管道符分隔
        "price": 0                          // 0 = 免费
      },
      "user_info": { "user_name": "粥里有勺糖" }
    }
  }
}
```

**获取章节内容**：

```json
// POST https://api.juejin.cn/booklet_api/v1/section/get
// Request Body:
{ "section_id": "7304230207517360169" }

// Response:
{
  "err_no": 0,
  "data": {
    "section": {
      "title": "在线运行Node.js",
      "content": "<p>HTML格式内容</p>",           // 免费小册只有 HTML
      "markdown_content": "Markdown格式内容"        // 付费小册才有
    }
  }
}
```

### 3.3 关键发现

| 发现 | 影响 |
|------|------|
| API 不需要认证（免费小册） | 可以直接调用，无需 Cookie |
| `section_ids` 用 `\|` 分隔 | 一次请求就能拿到全部章节 ID |
| 有 29 个 ID 但 `section_count` 是 28 | 第一个 ID 是小册介绍/前言 |
| 免费小册只有 `content`（HTML），没有 `markdown_content` | 内容是 HTML 格式，需注意 |
| ID 是 19 位数字 | URL 格式 `juejin.cn/book/{id}/section/{id}` |

### 3.4 认证分析

用 curl 直接测试：

```bash
curl -s -X POST 'https://api.juejin.cn/booklet_api/v1/booklet/get' \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://juejin.cn' \
  -d '{"booklet_id":"7304230207953567755"}'
```

返回 `"err_no": 0` —— **无需任何 Cookie 或 Token**。

> [!warning] 付费小册说明
> 免费小册（`price: 0`）无需认证。付费小册需要携带登录 Cookie，已通过 `--cookie` 参数支持（详见第九节）。

## 四、提取脚本实现

### 4.1 整体架构

```
extract-juejin-booklet.mjs
├── parseBookletId()     # 解析 URL/ID
├── fetchBookletInfo()   # 获取小册元数据
├── fetchAllSections()   # 批量获取章节
├── downloadFile()       # 下载单个文件（图片）
├── extractImageUrls()   # 从内容中提取图片 URL
├── downloadSectionImages()  # 批量下载章节图片
├── saveSectionAsMarkdown()  # 保存为 .md 文件
└── generateIndex()      # 生成 README.md 索引
```

### 4.2 核心设计决策

**决策 1：用 Node.js 原生 `https` 模块**

不引入 `axios`、`node-fetch` 等第三方依赖。原因：
- 脚本要作为 skill 内置工具，零依赖可以直接运行
- 掘金 API 只需简单的 POST + JSON，原生模块足够

**决策 2：图片 URL 替换为本地路径**

下载图片后，自动将 Markdown/HTML 中的远程 URL 替换为 `./images/xx` 相对路径：

```javascript
// 替换前
<img src="https://p6-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/xxx~tplv-k3u1fbpfcp-jj-mark:0:0:0:0:q75.image">

// 替换后
<img src="./images/02-1.image">
```

这样在 Obsidian 中查看时，图片能正常显示（只要 images 文件夹和 .md 文件在同一目录）。

**决策 3：请求间隔 300ms**

避免触发掘金的频率限制。29 个章节 × 300ms ≈ 9 秒，完全可接受。

### 4.3 请求函数实现

```javascript
function fetchJSON(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(url);

    const options = {
      hostname: urlObj.hostname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://juejin.cn',      // 必须，掘金校验 Origin
        'Referer': 'https://juejin.cn/',     // 必须，掘金校验 Referer
      },
    };

    const req = https.request(options, (res) => {
      let chunks = '';
      res.on('data', chunk => chunks += chunk);
      res.on('end', () => resolve(JSON.parse(chunks)));
    });
    req.write(data);
    req.end();
  });
}
```

> [!question] 这个脚本是怎么编写出来的？
>
> **实际流程**：
> 1. 用户提出需求："提取掘金小册全部内容"
> 2. Web Access 通过 CDP 自动观察浏览器网络请求，发现 API 端点和请求格式
> 3. Web Access 根据分析结果自动编写 `fetchJSON` 函数和完整提取脚本
> 4. 运行脚本提取全部内容
>
> 整个 API 逆向过程（观察请求、分析结构、编写脚本）由 Web Access 自动完成，用户无需手动操作 DevTools 或分析 API 格式。
>
> **关于请求头**：`Origin: https://juejin.cn` 和 `Referer: https://juejin.cn/` 是固定常量——掘金所有 API 都校验这两个值，不会变错。Web Access 在分析网络请求时已经捕获了这些必需的请求头信息。

> [!tip] Origin 和 Referer 头
> 很多 API 会校验这两个请求头，不加的话可能返回 403。这是 API 逆向时的常见坑——curl 能通但脚本不通时，先检查请求头是否完整。

### 4.4 图片提取策略

掘金图片 URL 格式：

```
https://p6-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/{hash}~tplv-k3u1fbpfcp-jj-mark:0:0:0:0:q75.image#?w=2600&h=3640&s=1971493&e=png&b=a504b7
```

特点：
- CDN 域名 `p6-juejin.byteimg.com`
- URL 中 `#` 后面有尺寸和格式参数
- 文件扩展名在 URL 末尾的 `e=png` 参数中

处理策略：直接下载完整 URL（含参数），用章节序号 + 图片序号命名（`02-1.image`）。

### 4.5 运行命令

```bash
node extract-juejin-booklet.mjs \
  "https://juejin.cn/book/7304230207953567755" \
  --output-dir "/path/to/obsidian/raw/notes/juejin/nodejs-intro-tutorial" \
  --download-images
```

参数说明：
- 第一个参数：小册 URL 或纯 booklet_id
- `--output-dir`：输出目录（默认当前目录下按标题创建）
- `--download-images`：启用图片下载

## 五、提取结果

### 5.1 运行输出

```
📖 获取小册信息: 7304230207953567755

📚 Node.js 入门教程
   作者: 粥里有勺糖
   章节: 28 | ID数: 29
   封面图已下载

📝 开始提取 29 个章节...
   [1/29] 小册介绍
   [2/29] 在线运行Node.js
   [3/29] 搭建本地开发环境
   ...
   [29/29] 进阶内容推荐

========== 提取完成 ==========
📚 小册: Node.js 入门教程
📝 章节: 29/29 篇已保存
🖼️  图片: 320 张已下载
📁 目录: /Users/.../raw/notes/juejin/nodejs-intro-tutorial
================================
```

### 5.2 数据统计

| 指标 | 数值 |
|------|------|
| 章节数 | 29（含 1 篇前言） |
| 图片数 | 321 张（含封面） |
| 总耗时 | ~15 秒 |
| 总文件大小 | ~50 MB |
| 脚本代码行数 | ~280 行 |
| 第三方依赖 | 0 |

### 5.3 输出文件示例

**README.md（索引）**：

```markdown
---
title: "Node.js 入门教程"
booklet_id: "7304230207953567755"
author: "粥里有勺糖"
section_count: 28
source: "https://juejin.cn/book/7304230207953567755"
tags: ["掘金小册"]
---

# Node.js 入门教程

> Node.js 0基础入门教程...

- **作者**: 粥里有勺糖
- **章节数**: 28
- **来源**: [掘金小册](https://juejin.cn/book/7304230207953567755)

## 目录

1. [小册介绍](./01-小册介绍.md)
2. [在线运行Node.js](./02-在线运行Node.js.md)
3. [搭建本地开发环境](./03-搭建本地开发环境.md)
...
```

**章节文件**：

```markdown
---
title: "在线运行Node.js"
booklet: "Node.js 入门教程"
section_id: "7304230207517360169"
section_index: 2
date: "2026-04-28"
tags: ["掘金小册", "Node.js 入门教程"]
---

<p>最初 <code>Node.js</code> 只能在本地运行...</p>
<p><img src="./images/02-1.image" alt=""></p>
...
```

## 六、Skill 封装

提取脚本完成后，将其集成到 `ob-collect` skill 中，让以后遇到掘金小册 URL 时自动使用。

### 6.1 集成点

在 `ob-collect/SKILL.md` 的**来源平台检测**表中新增：

| 平台 | 域名/特征 | raw 子目录 | 说明 |
|------|-----------|------------|------|
| 掘金小册 | `juejin.cn/book/` | `raw/juejin/` | 掘金小册全书提取（含图片） |

在目录初始化中新增 `raw/juejin/` 子目录。

### 6.2 脚本放置

```
ob-collect/
├── SKILL.md
├── scripts/
│   └── extract-juejin-booklet.mjs   ← 新增
└── references/
    └── ...
```

### 6.3 使用方式

封装后，用户只需：

```
ob-collect https://juejin.cn/book/7304230207953567755
```

skill 会自动：
1. 识别为掘金小册 URL
2. 运行提取脚本
3. 保存到 `raw/juejin/{booklet-slug}/`
4. 下载所有图片到 `images/` 子目录
5. 生成 README.md 索引

## 七、site-patterns 沉淀

掘金小册的提取经验沉淀到 web-access 的 `references/site-patterns/juejin.cn.md`，供 Web Access skill 在处理掘金相关请求时参考。

文件内容要点：
- API 端点和请求格式
- URL 模式（booklet_id / section_id 格式）
- 免费与付费的区别
- 图片下载注意事项
- 请求频率限制

## 八、总结与反思

### 关键收获

1. **API 逆向 > 浏览器自动化**：对于有公开 API 的 SPA 网站，直接调 API 比浏览器操作高效得多（15 秒 vs 可能数分钟）
2. **零依赖原则**：作为 skill 内置脚本，不引入第三方包（`axios` 等），用 Node.js 原生模块即可
3. **图片本地化是必需品**：远程图片 URL 会失效，必须下载到本地并替换引用路径

### 与 B 站视频提取的对比

| 维度 | B 站视频提取 | 掘金小册提取 |
|------|------------|------------|
| 方案 | CDP 浏览器模式 | API 逆向 |
| 认证 | Chrome 登录态 | 无需认证（免费） |
| 速度 | 慢（需等待页面渲染） | 快（纯 API 调用） |
| 依赖 | Chrome + CDP Proxy | 仅 Node.js |
| 内容类型 | DOM 结构化数据 | HTML/Markdown 文本 |
| 图片处理 | 无（提取元数据） | 需要批量下载 |

### 可改进方向

- ~~**付费小册支持**：添加 Cookie 认证参数~~ ✅ 已完成（见下方「付费小册扩展」）
- **HTML → Markdown 转换**：免费/付费小册都只返回 HTML，可用 `turndown` 库转换
- **增量更新**：检测已下载的章节，只更新变化的部分
- **多小册批量提取**：支持输入小册列表，并行提取

## 九、付费小册扩展

> 2026-04-27 更新：在免费小册提取流程基础上，扩展支持付费小册。

### 9.1 核心差异

| 维度 | 免费小册 | 付费小册 |
|------|---------|---------|
| API 认证 | 无需 Cookie | 需要登录 Cookie |
| `content` 字段 | HTML 格式 ✅ | HTML 格式 ✅ |
| `markdown_content` 字段 | 空 | **也是空的** |
| API 端点 | 相同 | 相同 |
| 请求频率限制 | 相同（300ms 间隔） | 相同 |

> [!warning] 实测发现
> 原文猜测"付费小册才有 `markdown_content`"，但实测发现**付费小册也不返回 Markdown**，只有 HTML。免费和付费在内容格式上没有区别。

### 9.2 Cookie 自动提取

付费小册的关键问题是获取登录 Cookie。手动从浏览器 DevTools 复制 Cookie 字符串太繁琐，因此编写了 `get-chrome-cookie.mjs` 脚本，**自动从 Chrome 本地 Cookie 数据库提取并解密 Cookie**。

#### Chrome Cookie 加密原理（macOS）

```
Chrome Cookie 加密链路：

1. macOS Keychain 存储"Chrome Safe Storage"密码
   └─→ security find-generic-password -w -s "Chrome Safe Storage"

2. PBKDF2 派生 AES 密钥
   └─→ PBKDF2(password, salt="saltysalt", iterations=1003, keylen=16, sha1)

3. Cookie 数据库（SQLite）
   └─→ ~/Library/Application Support/Google/Chrome/Default/Cookies

4. v10 格式解密
   └─→ 前缀 "v10" + 加密数据
   └─→ AES-128-CBC(key=派生密钥, IV=16*0x20)
   └─→ 前 32 字节为 Chrome 元数据（跳过），其余为实际 Cookie 值
```

> [!tip] 关键发现：32 字节元数据前缀
> Chrome 在加密 Cookie 值之前会追加 32 字节（2 个 AES block）的元数据。解密后需要跳过这 32 字节才能得到实际的 Cookie 值。
>
> 这不是公开文档记录的行为，是通过调试发现的：
> - 第一块 16 字节：因 IV 不匹配产生乱码（但 AES 密钥正确）
> - 第二块 16 字节：正确解密的元数据（但内容是二进制，非文本）
> - 第三块起：正确解密的 Cookie 值

#### 脚本使用

```bash
# 自动提取掘金 Cookie（从 Chrome 本地数据库）
node get-chrome-cookie.mjs juejin.cn

# 一条命令完成付费小册提取
COOKIE=$(node get-chrome-cookie.mjs juejin.cn 2>/dev/null | tail -1) && \
node extract-juejin-booklet.mjs <booklet_id> --cookie "$COOKIE" --download-images
```

### 9.3 付费小册提取结果

以「Babel 插件通关秘籍」（ID: 6946117847848321055）为例：

| 指标 | 数值 |
|------|------|
| 小册 | Babel 插件通关秘籍 |
| 作者 | zxg_神说要有光 |
| 章节数 | 38（含 1 篇前言） |
| 图片数 | 234 张（含封面） |
| 认证方式 | Chrome Cookie 自动提取 |
| 第三方依赖 | 0 |

### 9.4 脚本目录

```
scripts/
├── extract-juejin-booklet.mjs   # 小册提取（支持 --cookie / --cookie-file）
└── get-chrome-cookie.mjs         # Chrome Cookie 自动提取（仅 macOS）
```
