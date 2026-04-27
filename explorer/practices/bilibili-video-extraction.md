---
title: "实战演练：用 Web Access 提取 B 站 UP 主全部投稿视频数据"
article_id: OBA-bv2k9xqm
date: "2026-04-27"
source_notes:
  - "notes/web-access-article.md"
tags: ["web-access", "实战", "B站", "CDP", "浏览器自动化"]
---

# 实战演练：用 Web Access 提取 B 站 UP 主全部投稿视频数据

> 本文记录了使用 Web Access skill 的 CDP 浏览器模式，完成一个真实任务的完整过程：从 B 站搜索指定 UP 主 → 进入投稿视频页 → 逐页翻页 → 提取全部 183 个视频的结构化数据。重点记录了 DOM 探索策略、SPA 翻页踩坑和最终解决方案。

## 一、任务目标

提取 B 站 UP 主"战国时代_姜汁汽水"投稿视频页面的全部视频列表数据。

**目标数据字段**：视频标题、BV 号、播放量、弹幕数、视频时长、发布日期、标签。

**目标页面**：`https://space.bilibili.com/1039025435/upload/video`

**预期规模**：共 5 页，约 183 个视频。

## 二、前置准备

### 2.1 环境检查

Web Access 使用 CDP（Chrome DevTools Protocol）直连用户日常 Chrome 浏览器。开始前执行检查：

```bash
node "/Users/jiashengwang/.claude/skills/web-access/scripts/check-deps.mjs"
```

三项全部通过才能继续：

```
node: ok (v24.9.0)       # Node.js 22+，CDP Proxy 依赖原生 WebSocket
chrome: ok (port 9222)   # Chrome 已开启远程调试端口
proxy: ready             # CDP Proxy 服务就绪
```

### 2.2 核心须知

CDP 模式直连用户日常 Chrome，**天然携带登录态**，无需额外登录操作。

> [!warning] 风险提示
> 部分站点对浏览器自动化操作检测严格，存在账号封禁风险。已内置防护措施但无法完全避免，Agent 继续操作即视为接受。

## 三、完整操作流程

### 步骤 1：打开 B 站首页，检查登录状态

创建新的**后台 tab**（不干扰用户已有 tab）：

```bash
curl -s "http://localhost:3456/new?url=https://www.bilibili.com"
# → {"targetId":"A9D39AAC98B9E79F62C45DB1BC3EA9D7"}
```

后续所有操作都基于这个 targetId。

**检查登录状态**——通过 eval 查看 cookie 和页面元素：

```javascript
// 1. 检查登录态 cookie
const hasDedeUser = document.cookie.includes("DedeUserID");

// 2. 检查用户头像是否存在
const avatar = document.querySelector(".bili-avatar");

// 3. 检查导航栏登录后才可见的入口
const entries = document.querySelectorAll(".right-entry__outside");
// → ["大会员", "99+消息", "动态", "收藏", "历史", "创作中心"]
```

结果：`DedeUserID` cookie 存在 + 头像加载成功 + 导航栏完整 → **已登录**。

> [!tip] DOM 探索策略：为什么用 `.bili-avatar`？
> 这不是猜测。Web Access 的 CDP eval 可以在浏览器中执行任意 JS，实际操作中会用宽泛选择器先试探（如 `document.querySelectorAll("[class*=avatar]")`、`document.querySelectorAll("[class*=user]")`），观察返回结果，然后逐步缩小到精确选择器。`.bili-avatar` 是 B 站统一的用户头像组件 class，在多个页面通用。笔记中记录的是最终确定的精确选择器，省略了中间的探索过程。

### 步骤 2：搜索目标 UP 主

在搜索框输入关键词：

```javascript
const input = document.querySelector(".nav-search-input");
input.focus();
input.value = "战国时代_姜汁汽水";
input.dispatchEvent(new Event("input", { bubbles: true }));
```

> [!tip] 如何定位搜索框？
> 同样通过 DOM 探索策略：先用 `document.querySelector("input")` 或 `document.querySelector("[class*=search]")` 宽泛搜索，B 站首页的搜索输入框 class 是 `.nav-search-input`，这是 B 站导航栏的标准命名。在浏览器 DevTools 中也可以通过 Elements 面板检查来确认。

点击搜索按钮后，页面未跳转——B 站首页是 SPA，搜索按钮的 click 事件被框架拦截。改用**直接导航**到搜索结果页：

```bash
curl -s "http://localhost:3456/navigate?target=ID&url=https://search.bilibili.com/all?keyword=战国时代_姜汁汽水"
```

> [!tip] SPA 中 GUI 交互失败时的策略
> 当 GUI 交互（点击按钮、提交表单）在 SPA 中不生效时，回退到「直接导航到目标 URL」是更可靠的方式。搜索引擎结果页的 URL 结构通常是稳定的。

搜索结果页加载后，提取用户链接：

```javascript
const links = document.querySelectorAll('a[href*="space.bilibili.com"]');
// → 找到 href="https://space.bilibili.com/1039025435"
//    text="战国时代_姜汁汽水"
```

确认 UP 主：**战国时代_姜汁汽水**（UID: 1039025435）。

### 步骤 3：导航到投稿视频页面

```bash
curl -s "http://localhost:3456/navigate?target=ID&url=https://space.bilibili.com/1039025435/upload/video"
```

页面加载完成确认：

```
title: "战国时代_姜汁汽水投稿视频-战国时代_姜汁汽水视频分享-哔哩哔哩视频"
页脚: "共 5 页 / 183 个"
```

### 步骤 4：分析页面 DOM 结构

> [!important] 这是整个任务中最关键的一步
> B 站空间页的 CSS class 命名（如 `.upload-video-card`、`.bili-cover-card__stat`）完全无法从直觉猜到。**先花时间搞清楚 DOM 树，再写提取逻辑**，比盲目试各种选择器高效得多。

**探索策略**：

1. 用宽泛选择器试探：`document.querySelectorAll(".small-item")` → 不匹配
2. 找到最外层容器后，逐层 `children` 下探
3. 检查每层元素的 `textContent` 确认含义
4. 最终确定精确的提取选择器链

**发现的 DOM 树结构**：

```
.upload-content
  └── .video
      ├── .video-header
      ├── .video-body
      │   └── .video-list.grid-mode
      │       └── .upload-video-card (×40) ← 每页 40 个视频卡片
      └── .video-footer
          └── .vui_pagenation ← 分页控件
```

**单个视频卡片的关键节点**：

```
.upload-video-card
  └── .upload-video-card__left
      └── .upload-video-card__main
          └── .bili-video-card
              └── .bili-video-card__wrap
                  ├── .bili-video-card__cover
                  │   └── .bili-cover-card          ← href 包含视频链接 / BV 号
                  │       ├── .bili-cover-card__thumbnail img  ← 缩略图
                  │       ├── .bili-cover-card__tags            ← 标签（如"限时免费"）
                  │       └── .bili-cover-card__stats
                  │           ├── .bili-cover-card__stat  [0]  ← 播放量
                  │           ├── .bili-cover-card__stat  [1]  ← 弹幕数
                  │           └── .bili-cover-card__stat  [2]  ← 视频时长
                  └── .bili-video-card__details
                      ├── .bili-video-card__title               ← 标题
                      └── .bili-video-card__subtitle            ← 发布日期
```

### 步骤 5：编写数据提取脚本

基于上面分析出的 DOM 结构，编写提取逻辑：

```javascript
(() => {
  const cards = document.querySelectorAll(".upload-video-card");
  return Array.from(cards).map(card => {
    const coverCard = card.querySelector(".bili-cover-card");
    const stats = card.querySelectorAll(".bili-cover-card__stat");
    const titleEl = card.querySelector(".bili-video-card__title");
    const dateEl = card.querySelector(".bili-video-card__subtitle");
    const tagEl = card.querySelector(".bili-cover-card__tags");
    const href = coverCard ? coverCard.href : "";
    // 注意：使用 [a-zA-Z0-9] 而非 [\w]，避免 shell 多层转义吞掉 \w
    const match = href.match(/BV[a-zA-Z0-9]+/);
    const bvid = match ? match[0] : "";
    return {
      title: titleEl ? titleEl.textContent.trim() : "",
      bvid,
      play: stats[0] ? stats[0].textContent.trim() : "",
      danmaku: stats[1] ? stats[1].textContent.trim() : "",
      duration: stats[2] ? stats[2].textContent.trim() : "",
      date: dateEl ? dateEl.textContent.trim() : "",
      tag: tagEl ? tagEl.textContent.trim() : ""
    };
  }).filter(v => v.title);
})()
```

> [!info] 脚本是临时编写的吗？
> 是的。这正是 CDP 模式的核心优势——因为可以直接执行 JS，所以不需要预定义脚本。每个网站的 DOM 结构不同，提取逻辑需要根据步骤 4 中分析出的 DOM 树实时编写。这种方式灵活但依赖对目标页面 DOM 的准确理解。

### 步骤 6：翻页并逐页提取

**翻页是整个任务中最棘手的部分**。三种方式依次尝试，前两种均失败：

#### 方式 A：URL 翻页 → 失败

```
https://space.bilibili.com/1039025435/upload/video?page=2
```

B 站空间页是 SPA，URL 参数 `?page=2` 不触发内容变更，页面仍然显示第 1 页数据。

#### 方式 B：API 直接调用 → 失败

```javascript
await fetch("https://api.bilibili.com/x/space/wbi/arc/search?mid=1039025435&ps=30&pn=1")
// → {"code": -352, "message": "风控校验失败"}
```

B 站 WBI 签名 API 需要动态计算签名参数（`w_rid`、`wts`），直接调用会被风控拦截。

#### 方式 C：点击页码按钮 → 成功

> [!warning] CSS nth-child 选择器的陷阱
> `.vui_pagenation--btn:nth-child(2)` 实际点到了"上一页"按钮——分页按钮的 DOM 顺序和视觉顺序不一致。不能依赖位置选择器。

**正解**：通过文本内容精确匹配页码按钮：

```javascript
const btns = document.querySelectorAll("button.vui_pagenation--btn-num");
for (const btn of btns) {
  if (btn.textContent.trim() === "2") {  // 目标页码
    btn.click();
    break;
  }
}
```

每次翻页后等待 3 秒（`sleep 3`）让 SPA 完成数据加载，然后执行提取脚本。

**逐页执行结果**：

| 页码 | 视频数 | 首个视频标题 | 首个 BV 号 |
|------|--------|-------------|-----------|
| 1 | 40 | 双向防守：黄金、石油、股市（3） | BV15Dd2BcEEX |
| 2 | 40 | 日本越界的原因与处理方式 | BV1chyKBaEsL |
| 3 | 40 | 近期热点 (1-3)：关税，地缘，经济 | BV1pYKcz3EnN |
| 4 | 40 | 2025 - 2029 局势推演（第1集） | BV11L6HYCET1 |
| 5 | 23 | 新三线剧本：给下期视频开个头 | BV1pf42197Pe |

> [!note] SPA 翻页方式对比
> | 方式 | 操作 | 适用场景 |
> |------|------|---------|
> | URL 导航 | `/navigate?url=...?page=N` | 传统多页应用（MPA） |
> | 点击页码按钮 | eval 按文本匹配 + click | SPA 应用（本次使用） |
> | API 直接调用 | eval 中 fetch API | 无风控或可签名的 API |

> [!info] 为什么会想到这三个方案？
> 这三种方式覆盖了 Web 自动化中页面导航的所有手段：
> - **URL 翻页**：最直觉的方式，适用于传统多页应用（MPA），优先尝试
> - **API 调用**：开发者思维，直接拿数据最干净，但需要处理鉴权和风控
> - **按钮点击**：GUI 模拟，最后手段，但最通用
>
> 前两个不是"猜的"，而是按照"简单 → 复杂"的优先级依次尝试。URL 方式最简单所以先试，失败后升级到 API，API 被风控后才回退到按钮点击。这是一种系统化的降级策略。

### 步骤 7：合并数据并保存

```python
import json

all_videos = []
for i in range(1, 6):
    with open(f'/tmp/bili_p{i}.json') as f:
        all_videos.extend(json.load(f))

# 按 bvid 去重
seen = set()
unique = [v for v in all_videos if v['bvid'] not in seen and not seen.add(v['bvid'])]

with open('bili_videos.json', 'w') as f:
    json.dump(unique, f, ensure_ascii=False, indent=2)
```

**去重结果**：183 条原始数据 → 183 条去重后（无重复），与页面显示的"共 183 个"完全一致。

### 步骤 8：关闭 tab，清理环境

```bash
curl -s "http://localhost:3456/close?target=A9D39AAC98B9E79F62C45DB1BC3EA9D7"
# → {"success":true}
```

> [!tip] Web Access 的"最小侵入"原则
> 整个过程严格遵守：
> - **新建后台 tab** 操作，不触碰用户已有的 tab
> - 任务完成后**立即关闭**自己创建的 tab
> - 用户 Chrome 中的登录状态自然可用，无需额外处理

## 四、踩坑总结

### 4.1 DOM 探索是第一优先级

B 站空间页的 CSS class 名称完全不是直觉能猜到的。实测中 `.small-item`、`.video-list-item` 等常见命名全部不匹配，实际类名是 `.upload-video-card`、`.bili-cover-card__stat` 等。

**探索策略**：宽泛选择器探测 → 找到容器 → 逐层 children 下探 → 检查 textContent 确认含义 → 确定精确选择器链。

### 4.2 Shell 中的正则转义陷阱

提取 BV 号的正则 `BV[\w]+` 在 shell 字符串中需要写成 `BV[a-zA-Z0-9]+`。因为 `\w` 经过 bash → curl → eval 三层转义后容易被吞掉，导致 bvid 全部为空——这是一个**数据完整但关键字段丢失**的隐蔽 bug。

**规则**：在 shell 传递给 eval 的 JS 代码中，正则字符类用显式枚举（`[a-zA-Z0-9]`）代替简写（`[\w]`）。

### 4.3 SPA 翻页的三条路只有一条能走通

对于 B 站这类重度 SPA：

1. URL 翻页 → ❌ SPA 不响应 URL 参数
2. API 调用 → ❌ WBI 签名风控拦截
3. 按钮点击 → ✅ 唯一可靠方式

而且按钮点击也不能用位置选择器（DOM 顺序 ≠ 视觉顺序），必须按文本内容匹配。

## 五、最终成果

### 5.1 数据概览

| 维度 | 值 |
|------|-----|
| UP 主 | 战国时代_姜汁汽水（UID: 1039025435） |
| 视频总数 | 183 个 |
| 时间跨度 | 2024-04-19 ~ 2026-04-21（约 2 年） |
| 数据文件 | `bili_videos.json`（项目根目录） |

### 5.2 热门视频 TOP 10

| # | 标题 | 播放量 | 弹幕 | 时长 | 发布日期 |
|---|------|--------|------|------|---------|
| 1 | 刺杀后，民主党给共和党埋的下一个雷是什么 | 120.7万 | 9969 | 38:48 | 2024-07-14 |
| 2 | 美国大选最终预测，特朗普上台的影响 | 89.3万 | 5315 | 1:00:52 | 2024-11-05 |
| 3 | 美国经济观察：拐点已经出现 | 87.8万 | 2382 | 26:41 | 2024-08-05 |
| 4 | 川普的四大终极目标（金融经济角度 2/2） | 84.2万 | 2588 | 37:54 | 2024-11-11 |
| 5 | 以色列与伊朗冲突：阶段总结 | 82.6万 | 3835 | 34:26 | 2025-06-15 |
| 6 | 雅鲁藏布江下游水电站的地缘影响 | 81.9万 | 4483 | 29:04 | 2025-07-22 |
| 7 | 2025-2029 局势推演（第1集） | 79.8万 | 5013 | 47:14 | 2024-12-31 |
| 8 | 2025-2029 局势推演（第2集） | 76.9万 | 2823 | 46:19 | 2025-01-06 |
| 9 | 中东局势第二阶段正式开启 | 76.1万 | 4721 | 34:20 | 2024-08-03 |
| 10 | 阅兵总结（地缘角度） | 75.7万 | 1867 | 31:06 | 2025-09-14 |

### 5.3 内容主题分布

UP 主的内容主要集中在四个方向：

- **地缘政治**：中东、俄乌、美伊以冲突、台海、琉球
- **经济分析**：黄金、石油、美元美债、人民币、关税战
- **货币政策**：美联储利率路径、QE/QT、流动性、eSLR
- **时事热点**：川普政策、刺杀事件、美国大选

## 六、关键 API 速查

整个任务用到的 6 个 CDP Proxy API：

```bash
# 创建后台 tab（自动等待加载）
curl -s "http://localhost:3456/new?url=URL"

# 页面导航
curl -s "http://localhost:3456/navigate?target=ID&url=URL"

# 执行 JS（DOM 读取、数据提取、元素操作）
curl -s -X POST "http://localhost:3456/eval?target=ID" -d 'JS_CODE'

# 点击元素（CSS 选择器）
curl -s -X POST "http://localhost:3456/click?target=ID" -d 'SELECTOR'

# 获取页面信息
curl -s "http://localhost:3456/info?target=ID"

# 关闭 tab
curl -s "http://localhost:3456/close?target=ID"
```

## 七、参考资料

- [Web Access Skill](https://github.com/eze-is/web-access) — 本实战使用的 skill
- [B 站用户空间页](https://space.bilibili.com/1039025435/upload/video) — 目标页面
- [CDP Proxy 实现详解](../explorer/05-cdp-proxy-implementation.md) — web-access 项目研究笔记
