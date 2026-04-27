---
title: "Web Access 能力全景图：从工具设计到实战应用"
article_id: OBA-r9xk4pm2
date: "2026-04-27"
tags: ["web-access", "能力全景", "实战指南", "浏览器自动化", "CDP"]
---

# Web Access 能力全景图

> 从工具设计者、使用者、扩展者三个视角，全面梳理 Web Access 能做什么、还能做什么。

**文档定位**：基于 web-access 项目深度研究，从实战验证和理论推演两个维度，系统性梳理当前能力边界和未来扩展方向。

**研究基础**：
- SKILL.md 核心能力定义（257 行）
- explorer/ 目录 9 篇深度研究笔记
- notes/ 目录增量研究发现
- practices/bilibili-video-extraction.md 实战案例（183 个视频提取）

---

## 一、核心能力矩阵

### 1.1 确定可用能力（已验证）

#### 【信息发现层】WebSearch 搜索

**能力定义**：通过搜索引擎发现信息来源，定位一手资料。

**触发方式**：
- 用户明确说"搜索XX"
- 任务初期需要探索信息来源

**实现脚本**：Agent 内置，无需额外脚本

**适用场景**：
- ✅ 快速概览某个主题的多方观点
- ✅ 发现官网、新闻源、学术来源的入口
- ✅ 多个候选方案的初步调研

**实测案例**：
```bash
# 用户说："搜索 Claude Code 最新功能"
# Agent 自动调用 WebSearch，返回 10 个结果摘要
```

**限制**：
- 搜索引擎索引有延迟，最新内容可能搜不到
- 二手信息居多，需要进一步访问一手来源验证

---

#### 【内容提取层】URL 定向抓取

**能力定义**：当 URL 已知时，从页面定向提取特定信息。

**触发方式**：
- 用户直接提供 URL
- WebSearch 发现的候选链接

**实现脚本**：
- **WebFetch**（Agent 内置）：拉取网页内容，由小模型根据 prompt 提取，返回处理后结果
- **curl**：获取原始 HTML 源码（meta、JSON-LD 等结构化字段）
- **Jina**（可选）：`r.jina.ai/example.com`，将网页转为 Markdown，大幅节省 token

**适用场景对比**：

| 工具 | 优势 | 限制 | 适用 |
|------|------|------|------|
| WebFetch | 小模型智能提取，返回结构化结果 | 可能丢失细节 | 新闻文章、博客、文档 |
| curl | 保留完整 HTML，可提取 meta/结构化数据 | 需要自己解析 | SEO 分析、数据挖掘 |
| Jina | 节省 70-90% token，文章类效果好 | 非文章结构可能提取错误 | 长文阅读、论文综述 |

**实测案例**：
```bash
# 提取博客文章正文
curl -s "https://r.jina.ai/http://example.com/blog-post"

# 提取 JSON-LD 结构化数据
curl -s https://example.com | grep -A 10 '"application/ld+json"'
```

**限制**：
- 不处理登录态
- 反爬严格的平台（小红书、微信公众号）会失败

---

#### 【交互操作层】CDP 浏览器自动化

**能力定义**：通过 Chrome DevTools Protocol 直连用户日常 Chrome，像人一样在浏览器中操作页面。

**触发方式**：
- 需要登录态（"我在 B 站的视频列表"）
- 反爬严格平台（"小红书上关于XX的笔记"）
- 复杂交互（"填写表单并提交"）
- 动态内容（"加载这个页面的所有评论"）

**实现脚本**：
1. `check-deps.mjs`：环境检查 + Proxy 启动
2. `cdp-proxy.mjs`：HTTP → WebSocket 转换层
3. `curl` 调用 Proxy API

**核心 API 速查**：

```bash
# 创建后台 tab（自动等待加载）
curl -s "http://localhost:3456/new?url=https://example.com"

# 执行 JavaScript（DOM 读取、数据提取、元素操作）
curl -s -X POST "http://localhost:3456/eval?target=ID" -d 'document.title'

# 点击元素（CSS 选择器）
curl -s -X POST "http://localhost:3456/click?target=ID" -d 'button.submit'

# 滚动（触发懒加载）
curl -s "http://localhost:3456/scroll?target=ID&direction=bottom"

# 截图（视频帧、视觉识别）
curl -s "http://localhost:3456/screenshot?target=ID&file=/tmp/shot.png"

# 关闭 tab
curl -s "http://localhost:3456/close?target=ID"
```

**适用场景**：
- ✅ 需要登录态的私人内容（Gmail、公司内网）
- ✅ 反爬严格的社交平台（小红书、微博、B站）
- ✅ SPA 应用的翻页、动态加载
- ✅ 表单填写、文件上传
- ✅ 视频内容分析（seek 到任意时间点 + 截图采样）

**实战案例**：[B 站 UP 主 183 个视频数据提取](./bilibili-video-extraction.md)
- 翻页 5 次，每页 40 个视频
- 提取字段：标题、BV 号、播放量、弹幕数、时长、发布日期
- 关键技术：点击页码按钮翻页（URL 翻页和 API 调用均失败）

**限制**：
- 速度比 WebFetch/curl 慢（需要浏览器加载）
- 短时间内密集操作可能触发风控

---

#### 【本地资源层】Chrome 书签/历史检索

**能力定义**：从用户本地 Chrome 的书签和历史记录中检索 URL。

**触发方式**：
- 用户说"我之前看过的那个讲 XX 的文章"
- 组织内部系统（"我们公司的 XX 平台"）

**实现脚本**：`find-url.mjs`

**参数速查**：

```bash
# 搜索书签
node ~/.claude/skills/web-access/scripts/find-url.mjs github --only bookmarks --limit 3

# 搜索历史（最近 1 天）
node ~/.claude/skills/web-access/scripts/find-url.mjs github --only history --since 1d

# 按访问次数排序（找高频网站）
node ~/.claude/skills/web-access/scripts/find-url.mjs --only history --sort visits
```

**适用场景**：
- ✅ 找回之前看过的文章但忘记 URL
- ✅ 分析自己的浏览习惯（高频访问网站）
- ✅ 快速访问组织内部系统（公网搜不到）

**实测案例**：
```bash
$ node ~/.claude/skills/web-access/scripts/find-url.mjs github --only history --limit 3
[历史] 3 条（按最近访问）
  wangjs-jacky/web-access-study | https://github.com/wangjs-jacky/web-access-study | 2026-04-25 21:14:48
  jackwener/OpenCLI | https://github.com/jackwener/opencli | 2026-04-25 20:52:04 | visits=5
```

**限制**：
- 只能检索本用户 Chrome 数据
- 需要授予 Chrome 历史文件访问权限

---

#### 【经验积累层】站点模式匹配

**能力定义**：按域名存储操作经验（URL 模式、平台特征、已知陷阱），跨 session 复用。

**触发方式**：Agent 确定目标网站后，自动调用 `match-site.mjs` 匹配已有经验

**实现脚本**：`match-site.mjs`

**经验文件格式**：

```markdown
---
domain: bilibili.com
aliases: [B站, 哔哩哔哩, b站]
updated: 2026-04-21
---

## 平台特征
- 重度 SPA 应用，URL 参数不触发页面更新
- WBI 签名 API 需要动态计算参数，直接调用会被风控拦截

## 有效模式
- 翻页：点击页码按钮（不能用 URL `?page=N`）
- 视频列表：`.upload-video-card` 为容器，`.bili-cover-card__stat` 为统计信息

## 已知陷阱
- `.vui_pagenation--btn:nth-child(2)` 实际点的是"上一页"而非"第2页"
  → 必须按文本内容匹配页码按钮
- Shell 中的正则 `BV[\w]+` 会被多层转义吞掉
  → 应写成 `BV[a-zA-Z0-9]+`
```

**适用场景**：
- ✅ 重复访问同一网站（避免每次重新探索 DOM 结构）
- ✅ 团队共享站点操作经验（site-patterns 可提交到版本控制）

**实测案例**：B 站实战中发现的翻页陷阱，写入经验文件后，下次操作直接应用。

**限制**：
- 网站结构变化后经验失效（需要标注 `updated` 日期，当作"提示"而非"规则"）

---

### 1.2 实验验证能力（部分验证）

#### 【并行分治】多目标并行调研

**能力定义**：主 Agent 将多个独立调研目标分发给子 Agent，每个子 Agent 各自操作独立 tab，共享一个 Proxy。

**触发方式**：
- 用户说"调研 A、B、C 三个项目"
- 任务包含多个**独立**调研目标

**实现机制**：Agent 行为策略，非独立脚本

**实测效果**：
- **速度**：3 个目标并行，总耗时约等于单个目标时长（vs 串行 3 倍时间）
- **上下文保护**：抓取内容不进入主 Agent 上下文，主 Agent 只接收摘要

**子 Agent Prompt 写法关键**：

| ❌ 错误写法 | ✅ 正确写法 | 原因 |
|------------|------------|------|
| "搜索小红书上 XX" | "获取小红书上 XX" | "搜索"暗示 WebSearch，反爬站点搜不到 |
| "抓取 GitHub 的 API" | "调研 GitHub 的 API 限制" | "抓取"暗示 CDP，可能直接访问官网文档更快 |

**设计原则**：主 Agent 描述「要什么」，不暗示「怎么做」。

**适用场景**：
- ✅ 多个竞品对比调研
- ✅ 批量下载（多个视频、多个 PDF）
- ✅ 多个信息源的交叉验证

**限制**：
- 目标之间必须相互独立（有依赖关系不适合分治）

---

### 1.3 理论可行能力（技术可实现）

#### 【视频内容分析】视频离散采样

**技术基础**：CDP Proxy 已支持视频操作
- `/eval` 操控 `<video>` 元素（获取时长、seek 到任意时间点、播放/暂停）
- `/screenshot` 捕获当前视频帧

**理论实现**：

```javascript
// 1. 获取视频时长
const duration = document.querySelector("video").duration;

// 2. 等间隔采样（如每 5 分钟采一帧）
const frames = [];
for (let t = 0; t < duration; t += 300) {
  document.querySelector("video").currentTime = t;
  await new Promise(r => setTimeout(r, 1000)); // 等待跳转完成
  curl -s "http://localhost:3456/screenshot?target=ID&file=/tmp/frame_${t}.png";
  frames.push(`/tmp/frame_${t}.png`);
}

// 3. 批量读取截图，用视觉模型分析内容
```

**适用场景**：
- 视频教程提取关键帧（生成图文版）
- 监测视频中品牌 logo 出现时长
- 电影/长视频快速预览（采样封面墙）

**实现难度**：中等（需要异步等待和批量文件处理）

**实用价值**：高（视频内容结构化的刚需场景）

---

## 二、实战案例库

### 2.1 已验证场景

#### 【案例 1】B 站 UP 主视频数据提取

**目标网站**：bilibili.com

**操作步骤**：
1. 打开 B 站首页，检查登录状态（通过 cookie 和页面元素）
2. 搜索目标 UP 主"战国时代_姜汁汽水"
3. 导航到投稿视频页 `https://space.bilibili.com/1039025435/upload/video`
4. 分析 DOM 结构，确定视频卡片容器 `.upload-video-card`
5. 编写提取脚本（标题、BV 号、播放量、弹幕数、时长、发布日期）
6. 点击页码按钮翻页（URL 翻页和 API 调用均失败）
7. 逐页提取，合并 183 条数据

**产出结果**：
- 183 个视频的结构化数据（JSON 文件）
- 热门视频 TOP 10（播放量 75-120 万）
- 内容主题分布（地缘政治 40%、经济分析 30%、货币政策 20%、时事热点 10%）

**经验教训**：
1. **DOM 探索是第一优先级**：B 站 class 名称完全不可直觉猜测，必须先花时间搞清楚 DOM 树
2. **Shell 正则转义陷阱**：`BV[\w]+` 在多层转义中会被吞掉，应写成 `BV[a-zA-Z0-9]+`
3. **SPA 翻页的三条路**：URL 翻页 ❌ → API 调用 ❌ → 按钮点击 ✅
4. **按钮选择器不能用位置**：`:nth-child(2)` 可能点中"上一页"，必须按文本匹配

**参考文档**：[practices/bilibili-video-extraction.md](./bilibili-video-extraction.md)

---

#### 【案例 2】Chrome 历史记录分析

**目标**：找出自己高频访问的技术网站

**操作步骤**：
```bash
# 按访问次数排序，取前 20
node ~/.claude/skills/web-access/scripts/find-url.mjs \
  --only history --sort visits --limit 20
```

**产出结果**：
```
[历史] 20 条（按访问次数）
  Kimi AI 官网 - K2.6 上线 | https://www.kimi.com/ | visits=535
  localhost:5387 | http://localhost:5387/#/addinformation | visits=436
  GitHub | https://github.com/ | visits=312
```

**经验教训**：
- 分析自己的浏览习惯，发现常用的工具和平台
- 快速找回之前访问过但忘记收藏的页面

---

### 2.2 可复用模式

#### 【模式 1】SPA 翻页通用策略

**适用网站**：B 站、知乎、掘金等重度 SPA 应用

**通用流程**：
```
1. 尝试 URL 翻页（?page=N）
   ├─ 成功 → 用 URL 批量操作
   └─ 失败（页面不更新）→ 下一步

2. 尝试 API 直接调用
   ├─ 成功 → 批量调用 API
   └─ 失败（风控/签名）→ 下一步

3. GUI 交互：点击页码按钮
   ├─ 按文本内容匹配（不用位置选择器）
   ├─ 点击后等待 SPA 渲染（sleep 2-3s）
   └─ 提取当前页数据
```

**关键代码模板**：
```javascript
// 点击页码按钮（按文本匹配）
const btns = document.querySelectorAll("button.vui_pagenation--btn-num");
for (const btn of btns) {
  if (btn.textContent.trim() === "2") {  // 目标页码
    btn.click();
    break;
  }
}
```

---

#### 【模式 2】DOM 探索四步法

**适用场景**：未知页面结构的首次探索

**流程**：
```
1. 宽泛选择器探测
   document.querySelectorAll(".item")
   document.querySelectorAll("[class*=video]")

2. 找到最外层容器后，逐层 children 下探
   container.children[0].className

3. 检查每层元素的 textContent 确认含义
   titleEl.textContent // "视频标题"
   statEl.textContent // "播放量"

4. 确定精确的提取选择器链
   document.querySelectorAll(".upload-video-card .bili-cover-card__stat")
```

**关键原则**：
- 不猜测 class 名称，而是通过试探确定
- 先看结构再看数据（避免过早优化）

---

## 三、能力扩展畅想

### 3.1 网页截图与归档

**需求场景**：
- 保存重要页面的视觉快照（新闻、公告、商品页）
- 生成网页缩略图（用于文档、PPT）
- 监测页面变化（定期截图对比）

**技术路径**：
```bash
# 全页截图
curl -s "http://localhost:3456/screenshot?target=ID&file=/tmp/page.png&fullPage=true"

# 元素截图（先获取坐标）
curl -s -X POST "http://localhost:3456/eval?target=ID" -d '
  const el = document.querySelector(".main-content");
  const rect = el.getBoundingClientRect();
  JSON.stringify({x: rect.x, y: rect.y, width: rect.width, height: rect.height})
'
```

**实现难度**：低（API 已支持，需封装批量操作）

**实用价值**：高（网页归档、设计参考、法律证据保存）

**封装建议**：
- Skill：「网页截图归档」
- 输入：URL 列表 + 输出目录
- 产出：文件名自动按时间戳命名，生成 Markdown 索引

---

### 3.2 PDF 生成与文档聚合

**需求场景**：
- 将多篇网页文章汇总成一个 PDF
- 生成技术周刊（精选文章 + 批量转 PDF）
- 知识库归档（博客文章离线化）

**技术路径**：
```bash
# 方案 1：用浏览器的打印功能
curl -s -X POST "http://localhost:3456/eval?target=ID" -d '
  window.print();  // 触发打印对话框，需手动保存 PDF
'

# 方案 2：用 Jina 提取 Markdown + 本地工具转 PDF
curl -s "https://r.jina.ai/http://example.com/article" | \
  pandoc -o article.pdf
```

**实现难度**：中（需要整合外部工具）

**实用价值**：高（内容创作者刚需）

**封装建议**：
- Skill：「掘金小册提取」
- 功能：自动翻页提取小册所有章节，合并成单个 PDF
- 挑战：反爬处理（需要模拟真实用户行为）

---

### 3.3 内容翻译与本地化

**需求场景**：
- 批量翻译技术文档（英文 → 中文）
- 多语言内容同步（官方文档翻译）
- 外文资料快速理解

**技术路径**：
```javascript
// 1. 用 Jina 提取 Markdown
const content = await fetch("https://r.jina.ai/http://example.com/en-doc");

// 2. 调用翻译 API（如 DeepL、Claude API）
const translated = await translate(content, { from: "en", to: "zh" });

// 3. 生成双语对照文档
const bilingual = `
## 原文
${content}

## 翻译
${translated}
`;
```

**实现难度**：低（API 成熟）

**实用价值**：高（跨语言知识获取）

**封装建议**：
- Skill：「网页翻译助手」
- 功能：自动检测语言 → 提取正文 → 翻译 → 保留格式
- 优化：技术术语不翻译（添加白名单）

---

### 3.4 价格监控与竞品追踪

**需求场景**：
- 电商平台价格监测（京东、淘宝）
- SaaS 产品价格变化追踪
- 竞品功能对比（定期抓取产品页）

**技术路径**：
```javascript
// 1. 定时任务（cron）
// 每 6 小时检查一次

// 2. 提取价格
const price = document.querySelector(".price").textContent;

// 3. 对比历史数据
if (price < history.lowest) {
  notify("价格跌破历史最低！当前: " + price);
}

// 4. 记录到数据库
db.insert({ timestamp: Date.now(), price });
```

**实现难度**：中（需要定时任务 + 数据存储）

**实用价值**：中（特定人群刚需）

**封装建议**：
- Skill：「价格监控助手」
- 功能：输入 URL + 价格阈值 → 定时检查 → 变化通知
- 挑战：反爬（需要随机访问间隔）

---

### 3.5 自动化测试与 UI 回归

**需求场景**：
- 关键业务路径自动化测试（下单流程、注册流程）
- UI 回归测试（版本更新后检查页面是否正常）
- 性能监测（页面加载时间、资源大小）

**技术路径**：
```javascript
// 1. 定义测试用例
const tests = [
  {
    name: "搜索功能",
    steps: [
      { action: "navigate", url: "https://example.com" },
      { action: "type", selector: "#search", value: "keyword" },
      { action: "click", selector: "button.search" },
      { action: "waitFor", selector: ".search-results" }
    ],
    assert: "搜索结果应包含关键词"
  }
];

// 2. 执行测试
for (const test of tests) {
  for (const step of test.steps) {
    await executeStep(step);
  }
  // 截图保存
  await screenshot({ file: `/tmp/test-${test.name}.png` });
}
```

**实现难度**：高（需要完整的测试框架）

**实用价值**：高（QA 团队刚需）

**封装建议**：
- Skill：「Web UI 自动化测试」
- 功能：YAML 定义测试用例 → 自动执行 → 生成测试报告
- 优势：复用现有 CDP 能力，无需 Selenium

---

### 3.6 社交媒体内容聚合

**需求场景**：
- 聚合某个话题的多平台内容（微博、小红书、知乎）
- KOL 内容追踪（自动下载最新发布）
- 热点事件分析（多平台舆情汇总）

**技术路径**：
```javascript
// 1. 多平台并行抓取
const platforms = [
  { name: "微博", url: "https://s.weibo.com/weibo?q=keyword" },
  { name: "小红书", url: "https://xiaohongshu.com/search_result?keyword=keyword" },
  { name: "知乎", url: "https://www.zhihu.com/search?type=content&q=keyword" }
];

// 2. 子 Agent 并行处理（每个平台一个子 Agent）
const results = await Promise.all(
  platforms.map(p => spawnSubAgent(p))
);

// 3. 去重、排序、生成摘要
const aggregated = aggregateResults(results);
```

**实现难度**：高（每个平台反爬策略不同）

**实用价值**：中（媒体、运营人员刚需）

**封装建议**：
- Skill：「全网热点聚合」
- 功能：输入关键词 → 多平台搜索 → 去重排序 → 生成简报
- 挑战：每个平台需要独立的 site-pattern

---

## 四、Site Pattern 沉淀机会

基于 B 站实战经验，以下网站类型值得沉淀为 site pattern：

### 4.1 内容平台类

**典型特征**：
- 重度 SPA 应用
- 无限滚动或分页加载
- 反爬严格（需要登录态、设备指纹）

**代表网站**：B 站、知乎、掘金、小红书

**关键模式**：
- **翻页策略**：URL 参数 → API 调用 → GUI 点击（按文本匹配）
- **登录判断**：检查 cookie + 页面特定元素（头像、用户名）
- **内容加载**：等待 `document.readyState === 'complete'` 不够，需要检查目标元素是否存在

**模板文件**：
```markdown
---
domain: example.com
aliases: [示例]
updated: 2026-04-27
---

## 平台特征
- 架构：SPA 应用，URL 参数不触发内容更新
- 反爬：需要登录态，设备指纹检测
- 登录判断：检查 cookie `session_token` 和元素 `.user-avatar`

## 有效模式
- 翻页：点击页码按钮 `.pagination-btn`，按文本匹配，不能用 `:nth-child`
- 内容提取：`.content-item` 为容器，`.title` 为标题，`.stats` 为统计信息

## 已知陷阱
- URL `?page=N` 不触发页面更新
- API 直接调用返回 403（需要签名）
- 快速连续点击会触发风控（每次点击间隔至少 2s）
```

---

### 4.2 电商类

**典型特征**：
- 商品详情页结构复杂（SKU 选择、价格计算）
- 实时库存/价格变化
- 强反爬（滑块验证、行为分析）

**代表网站**：京东、淘宝、拼多多

**关键模式**：
- **SKU 选择**：先点击规格选项，再读取价格（JS 变量或 API）
- **库存判断**：检查按钮文案（"立即购买" vs "到货通知"）
- **评论加载**：分页 + 懒加载，需要滚动触发

---

### 4.3 文档类

**典型特征**：
- 结构化内容（标题、代码块、表格）
- 可能有多级导航
- 相对反爬宽松

**代表网站**：MDN、Vue 文档、React 文档

**关键模式**：
- **内容提取**：用 Jina 直接转 Markdown（准确率高）
- **导航遍历**：递归访问侧边栏链接，生成索引
- **代码块提取**：`<pre><code>` 标签，按语言分类

---

### 4.4 搜索引擎类

**典型特征**：
- 搜索结果页结构稳定
- 分页规律（URL 参数或滚动加载）
- 少量反爬（主要是 IP 限制）

**代表网站**：Google、Bing、百度

**关键模式**：
- **结果提取**：`.search-result` 为容器，`.title` 为标题，`.snippet` 为摘要
- **分页**：URL `?start=10` 或 `?page=2`
- **高级搜索**：构造 URL 参数（`&tbs=qdr:d` 限制时间范围）

---

### 4.5 社交媒体类

**典型特征**：
- 动态内容流（Feed 流）
- 用户生成内容（UGC）
- 强反爬（需要登录、频率限制）

**代表网站**：微博、推特、Instagram

**关键模式**：
- **Feed 流加载**：滚动触发，每次加载 10-20 条
- **登录判断**：检查 cookie 和用户头像
- **时间线排序**：按发布时间降序，提取时间戳

---

## 五、技能封装建议

### 5.1 独立 Skill 封装

#### 【掘金小册提取】

**功能描述**：
- 自动翻页提取小册所有章节
- 合并成单个 PDF 或 Markdown 文件
- 保留代码高亮和图片

**技术路径**：
```javascript
// 1. 打开小册目录页
curl -s "http://localhost:3456/new?url=https://juejin.cn/book/XXXX"

// 2. 提取所有章节链接
const chapters = await eval(`
  Array.from(document.querySelectorAll(".chapter-link"))
    .map(a => a.href)
`);

// 3. 逐章提取内容（并行）
const contents = await Promise.all(
  chapters.map(url => extractChapter(url))
);

// 4. 合并并生成 PDF
const pdf = await generatePDF(contents);
```

**实现难度**：中

**实用价值**：高（技术学习刚需）

---

#### 【网页截图归档】

**功能描述**：
- 批量截图 URL 列表
- 自动按时间戳命名
- 生成 Markdown 索引（缩略图 + 原始链接）

**技术路径**：
```bash
# 1. 读取 URL 列表
cat urls.txt | while read url; do
  # 2. 创建 tab 并截图
  T=$(curl -s "http://localhost:3456/new?url=$url" | jq -r '.targetId')
  curl -s "http://localhost:3456/screenshot?target=$T&file=archive/$(date +%s).png"
  
  # 3. 关闭 tab
  curl -s "http://localhost:3456/close?target=$T"
done

# 4. 生成索引
python3 generate_index.py archive/
```

**实现难度**：低

**实用价值**：中（知识管理辅助）

---

#### 【价格监控助手】

**功能描述**：
- 输入商品 URL 和目标价格
- 定时检查（如每 6 小时）
- 价格低于目标时通知

**技术路径**：
```javascript
// 1. 定义监控任务
const tasks = [
  { url: "https://example.com/product", targetPrice: 100, interval: "6h" }
];

// 2. 定时执行
setInterval(async () => {
  for (const task of tasks) {
    const currentPrice = await extractPrice(task.url);
    if (currentPrice <= task.targetPrice) {
      notify(`价格达标！${task.url} 当前: ${currentPrice}`);
    }
  }
}, 6 * 60 * 60 * 1000);
```

**实现难度**：中

**实用价值**：中（购物决策辅助）

---

#### 【多平台热点聚合】

**功能描述**：
- 输入关键词
- 同时搜索微博、小红书、知乎、B 站
- 去重、排序、生成简报

**技术路径**：
```javascript
// 1. 多平台并行搜索
const platforms = [
  { name: "微博", extractor: extractWeibo },
  { name: "小红书", extractor: extractXiaohongshu },
  { name: "知乎", extractor: extractZhihu },
  { name: "B站", extractor: extractBilibili }
];

// 2. 子 Agent 并行（每个平台一个）
const results = await Promise.all(
  platforms.map(p => spawnSubAgent(p.name, p.extractor, keyword))
);

// 3. 聚合去重
const aggregated = aggregate(results);

// 4. 生成简报（Markdown）
const report = generateReport(aggregated);
```

**实现难度**：高

**实用价值**：高（运营、媒体人员刚需）

---

### 5.2 Skill 组合模式

#### 【研究助手 Skill Chain】

```
[WebSearch] 发现信息来源
    ↓
[WebFetch/Jina] 提取文章正文
    ↓
[CDP 浏览器] 补充动态内容（评论、相关推荐）
    ↓
[本地分析] 生成摘要 + 交叉验证
```

**场景**：学术研究、行业分析

---

#### 【内容创作 Skill Chain】

```
[多平台搜索] 发现热点话题
    ↓
[内容提取] 聚合多平台观点
    ↓
[CDP 浏览器] 深挖细节（原文、数据来源）
    ↓
[生成大纲] 输出结构化写作框架
```

**场景**：自媒体内容创作

---

#### 【竞品分析 Skill Chain】

```
[并行 CDP] 同时打开 N 个竞品页面
    ↓
[DOM 提取] 抓取产品功能、定价、文案
    ↓
[对比分析] 生成差异化矩阵
    ↓
[PDF 导出] 输出分析报告
```

**场景**：产品经理、市场调研

---

## 六、能力边界与风险

### 6.1 技术边界

| 限制 | 原因 | 影响 |
|------|------|------|
| **无法处理验证码** | 验证码设计就是阻止自动化 | 需要用户手动介入 |
| **无法绕过强风控** | 设备指纹、IP 封禁、行为分析 | 频繁操作可能触发封号 |
| **视频音频下载受限** | 需要登录态 + 加密流媒体 | 只能截图采样，无法下载原文件 |
| **复杂 Canvas/ WebGL** | 浏览器渲染的图形无法直接提取 | 需要截图后用视觉模型识别 |

### 6.2 使用风险

| 风险 | 场景 | 缓解措施 |
|------|------|---------|
| **账号封禁** | 频繁操作触发反爬 | 控制操作频率，模拟真实用户行为 |
| **隐私泄露** | 操作用户 Chrome 时的登录态 | 只在后台 tab 操作，不触碰用户数据 |
| **法律风险** | 批量抓取受版权保护的内容 | 仅用于个人研究，不商业使用 |

**SKILL.md 强制提示**：
```
温馨提示：部分站点对浏览器自动化操作检测严格，存在账号封禁风险。
已内置防护措施但无法完全避免，Agent 继续操作即视为接受。
```

---

## 七、总结

### 7.1 Web Access 的核心价值

1. **三层通道调度**：WebSearch → WebFetch → CDP，自动升级，成本最优
2. **目标导向哲学**：不给 AI 固定流程，而是提供技术事实让它自主决策
3. **经验积累机制**：site-patterns 跨 session 复用，越用越聪明
4. **并行分治策略**：多目标并行处理，效率提升 + 上下文保护

### 7.2 能力演进路径

```
当前可用（已验证）
├─ 信息发现（WebSearch）
├─ 内容提取（WebFetch/curl/Jina）
├─ 交互操作（CDP 浏览器）
├─ 本地检索（Chrome 书签/历史）
└─ 经验积累（site-patterns）

未来可扩展（理论可行）
├─ 视频内容分析（离散采样）
├─ 网页截图归档（批量操作）
├─ PDF 生成（文档聚合）
├─ 价格监控（定时任务）
├─ 自动化测试（UI 回归）
└─ 社交媒体聚合（多平台并行）
```

### 7.3 设计哲学总结

> **通过提供「理解」而非「指令」，让 AI 像人一样思考和决策。**

这不是简单的工具集合，而是**知识体系 + 决策框架 + 约束机制**的综合体。适用于所有需要 AI 在复杂、不确定环境中进行决策的场景。

---

## 参考资料

- [Web Access Skill 官方文档](https://github.com/eze-is/web-access)
- [SKILL.md 完整内容](../web-access/SKILL.md)
- [B 站实战案例](./bilibili-video-extraction.md)
- [研究笔记目录](../explorer/README.md)
- [CDP Proxy 实现详解](../explorer/05-cdp-proxy-implementation.md)
- [Prompt Engineering 分析](../explorer/09-skill-prompt-engineering.md)
