---
title: "Web Access：一个 Skill 如何让 AI Agent 拥有完整联网能力"
date: "2026-04-26"
source_notes:
  - "notes/architecture-overview.md"
  - "notes/cdp-proxy-implementation.md"
  - "notes/local-resource-and-experience.md"
  - "notes/skill-to-script-mapping.md"
  - "notes/web-access-guide.md"
tags: ["技术展示", "AI Agent", "浏览器自动化", "CDP"]
---

# Web Access：一个 Skill 如何让 AI Agent 拥有完整联网能力

10 个子 Agent 同时启动，小红书、微博、B站、Boss直聘、GitHub、知乎、即刻、豆瓣、36kr、虎嗅——每个平台各自开 10 个 tab，100 个网页在同一个 Chrome 窗口里并行运转。不抢焦点、不要登录、不装插件。Agent 自行站内搜索、滚动阅读、提取内容，最后汇总成一份完整报告。

这不是科幻场景，这是 [Web Access](https://github.com/eze-is/web-access) 这个 Skill 的日常表现。5600+ Stars，核心代码约 550 行，整个项目 11 个文件。

我花了几天时间深入研究了这个项目的每一行代码。这篇文章不是翻译 README，而是从研究者的视角，拆解它**为什么能做到这些**，以及它的设计思路能给 AI Agent 开发者带来什么启发。

## 现有方案到底差在哪

先不急着讲 Web Access。我们看看当前主流 Agent 的联网能力，问题在哪。

**Claude Code**：WebSearch 搜索、WebFetch 读页面。听起来够用，但实际呢？当你让 Agent "调研小红书上关于 Qwen 的风评"，它大概率这样做：

- 拿 WebSearch 换各种关键词搜索，试图找到公开页面的内容——但小红书内容搜索引擎根本收不到
- 用 WebFetch 直接请求小红书页面——需要登录 + JS 渲染，拿回来一堆空壳 HTML
- 让你装 Playwright / Chrome DevTools MCP——踩坑之旅刚刚开始

**其他 Agent 框架**的问题也类似：要么工具不全面，只能一条道走到黑；要么有 CDP 模式但要单独维护浏览器 Profile，每个网站重新登录；要么想并行操作多个网页，结果 Agent 之间互相抢浏览器控制权。

一个理想的 Agent 联网方案应该长这样：

1. **灵活调度**：遇到障碍能自己换工具，不在死路上反复撞
2. **复用登录态**：直接用你的 Chrome，不为每个站点单独维护身份
3. **泛化能力**：不依赖针对特定网站的预设脚本，任何你能打开的网站 Agent 都能用
4. **并行分治**：多目标时并行执行，后台操作互不干扰
5. **经验沉淀**：同一个网站踩过的坑，下次不用再踩

Web Access 给出了它的答案。

## 5 分钟上手

### 安装

```bash
# 一行命令安装
npx skills add eze-is/web-access
```

前置条件：Node.js 22+ 和 Chrome 开启远程调试（地址栏输入 `chrome://inspect/#remote-debugging`，勾选允许）。

装好后，在 Agent 里说"帮我查 XX"或"打开 XX"，Agent 就会自动加载 Skill，根据任务选择最合适的联网方式。

### 架构一览

```
                    AI Agent (Claude Code / Cursor / ...)
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │     SKILL.md           │
                    │  浏览哲学 + 策略 + 指令  │
                    └────────────┬───────────┘
                                 │
                ┌────────────────┼────────────────┐
                ▼                ▼                ▼
           WebSearch        WebFetch/curl      CDP Proxy
           (内置搜索)        (静态读取)      (HTTP :3456)
                                                 │
                                                 ▼
                                         WebSocket 连接
                                                 │
                                                 ▼
                                          你的 Chrome 浏览器
                                         (天然携带登录态)
```

Agent 拿到一个联网任务时，不会直接上浏览器。它先判断：能搜索解决的就搜索，URL 已知的就 curl 抓取，文章类页面走 Jina 转 Markdown 省 token，实在需要登录态或动态渲染的才启动 CDP。这个四层调度——**WebSearch -> WebFetch/curl -> Jina -> CDP**——按代价从轻到重，是整个项目的基础设计。

## 一句话设计公式

研究了 SKILL.md 和源码之后，我提炼出作者的设计公式：

> **激发模型能力上限的 Skill = Agent 策略哲学 + 最小完备工具集 + 必要的事实说明**

这三层各有深意，逐个展开。

### 哲学式设计：不教怎么做，教怎么想

Web Access 最让我印象深刻的不是它的 CDP 实现，而是 SKILL.md 里对 AI 的引导方式。

大多数 Skill 或 Prompt 的写法是："遇到 XX 情况，执行 YY 步骤"。这是操作手册。Web Access 不这么干。它定义了一个四步思考框架：

1. **拿到任务，先定义成功标准**——什么算完成？
2. **选一个最可能直达的方式作为起点去验证**——比如小红书是反爬平台，直接进浏览器，别在搜索上浪费时间
3. **过程校验**——搜索没命中，不一定是关键词不对，也可能是目标本身不存在
4. **对照成功标准确认完成**——不过度操作

注意，这里面没有一行"遇到 XX 网站就执行 YY 操作"的硬编码指令。它只告诉 AI "怎么思考联网任务"。Agent 理解了这个框架，遇到从没见过的网站也能给出更好的策略。

这不是我凭空总结的——SKILL.md 里写的是"技术事实"（Technical Facts），不是"操作步骤"。比如说：

> 不说"遇到小红书就用 CDP"
>
> 而是说"小红书是已知静态层无效的平台"

这种写法让 AI 理解背后的 tradeoff，然后自主决策。

### 最小完备工具集

人类上网其实就三种行为：**搜**（找到信息在哪）、**看**（看到内容）、**做**（在页面上执行操作）。覆盖这三种行为，工具集就完备了。

| 行为 | 工具 | 能力边界 |
|------|------|----------|
| 搜 | WebSearch | 搜索摘要、发现信息来源 |
| 看 | WebFetch / curl / Jina | 公开页面读取、Markdown 转换 |
| 做 | CDP 浏览器自动化 | 点击、填表、上传、滚动、截图 |

Skill 里用一张工具能力说明表，把每个工具的边界说清楚，让模型在不同任务中自主规划。建议尽可能只向模型交代基础说明，不做过多策略引导——引导太多，反而限制模型的自主判断空间。

### 必要的事实说明

模型近乎知道所有知识，但并非所有知识都能在任务中被第一时间调用。Web Access 称之为"惰性知识"。

一个典型例子：Agent 关闭浏览器 tab 时，如果没特别说明，它可能顺手把你正在用的 tab 也关了。SKILL.md 里有一段关于安全边界的强调：

> 绝不关闭或操作用户已有的 tab，只操作自己创建的后台 tab

这种"看似多余"的说明，恰恰是工程实践中最容易被忽略的。

## 三个技术亮点

这部分是我认为 Web Access 最值得深入分析的三个实现细节。不看源码，很难意识到这些设计的精妙之处。

### 亮点 1：Pending Map——异步请求-响应的优雅匹配

CDP Proxy 的核心挑战是：Agent 发的是 HTTP 请求（同步等待结果），但底层是 WebSocket 通信（异步消息流）。怎么把"发一条命令、等一个回复"这个简单的语义，映射到异步的 WebSocket 上？

答案就是 **Pending Map** 模式。

**核心思路**：每条发出的命令分配一个唯一递增 ID，把一个 Promise 存进 Map。当 WebSocket 那边收到带相同 ID 的消息时，取出 Promise resolve 掉。

看源码（`cdp-proxy.mjs` 第 16 行和第 202-217 行）：

```javascript
// 全局状态
let cmdId = 0;
const pending = new Map(); // id -> {resolve, timer}

// 发送 CDP 命令
function sendCDP(method, params = {}, sessionId = null) {
  return new Promise((resolve, reject) => {
    const id = ++cmdId;              // 每条命令分配唯一 ID
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;

    // 30 秒超时保护
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('CDP 命令超时: ' + method));
    }, 30000);

    pending.set(id, { resolve, timer });  // 存入 Map
    ws.send(JSON.stringify(msg));         // 通过 WebSocket 发出
  });
}
```

收到消息时的匹配逻辑（第 174-178 行）：

```javascript
// WebSocket 收到消息
if (msg.id && pending.has(msg.id)) {
  const { resolve, timer } = pending.get(msg.id);
  clearTimeout(timer);          // 清除超时定时器
  pending.delete(msg.id);       // 从 Map 中移除
  resolve(msg);                 // resolve 对应的 Promise
}
```

**为什么这个设计重要？**

试想如果没有 Pending Map，你会怎么做？

```
// 方案 A：全局回调
let currentCallback = null;
function sendCDP(method, params) {
  return new Promise(resolve => {
    currentCallback = resolve;  // 只能同时处理一个请求！
    ws.send(JSON.stringify({ method, params }));
  });
}
// 问题：并发请求会互相覆盖回调
```

```
// 方案 B：事件监听
function sendCDP(method, params) {
  return new Promise(resolve => {
    ws.addEventListener('message', function handler(evt) {
      const msg = JSON.parse(evt.data);
      if (/* 这个消息是对我这条命令的回复？ */) {
        ws.removeEventListener('message', handler);
        resolve(msg);
      }
    });
    ws.send(JSON.stringify({ method, params }));
  });
}
// 问题：怎么判断"这条消息是对我的回复"？没有 ID 就无法区分
```

Pending Map 用一个 Map + 递增 ID，把并发乱序的异步消息流变成了可预测的请求-响应模型。简洁、线程安全、支持并发。这是我见过的 WebSocket 封装中最优雅的模式之一。

### 亮点 2：反风控端口拦截——Fetch.enable 的巧妙运用

很多网站会检测用户是否在使用自动化工具。一个常见的检测手段是：**探测 Chrome 调试端口是否开放**。

原理很简单：如果页面里的 JavaScript 能访问 `http://127.0.0.1:9222/json` 并得到响应，说明 Chrome 开启了远程调试，很可能是自动化操作。

Web Access 的解决方案非常巧妙（`cdp-proxy.mjs` 第 235-248 行）：

```javascript
// 拦截页面对 Chrome 调试端口的探测（反风控）
// 只拦截 127.0.0.1:{chromePort} 的请求，不影响其他任何本地服务
async function enablePortGuard(sessionId) {
  if (!chromePort || portGuardedSessions.has(sessionId)) return;
  try {
    await sendCDP('Fetch.enable', {
      patterns: [
        // 拦截所有对 Chrome 调试端口的请求
        { urlPattern: `http://127.0.0.1:${chromePort}/*`, requestStage: 'Request' },
        { urlPattern: `http://localhost:${chromePort}/*`, requestStage: 'Request' },
      ]
    }, sessionId);
    portGuardedSessions.add(sessionId);
  } catch { /* Fetch 域启用失败不影响主流程 */ }
}
```

拦截到请求后怎么处理？直接让请求失败（第 170-173 行）：

```javascript
// 收到被拦截的请求
if (msg.method === 'Fetch.requestPaused') {
  const { requestId, sessionId: sid } = msg.params;
  // 返回 ConnectionRefused——就像端口根本没开一样
  sendCDP('Fetch.failRequest', {
    requestId,
    errorReason: 'ConnectionRefused'
  }, sid).catch(() => {});
}
```

**Before vs After**：

| 场景 | 无 Port Guard | 有 Port Guard |
|------|-------------|-------------|
| 网页 JS 探测 `127.0.0.1:9222` | 收到响应 → 检测到自动化 | ConnectionRefused → 看起来像普通用户 |
| 影响范围 | — | 只拦截调试端口的请求，其他本地服务不受影响 |
| 每个新 tab | — | 自动启用，不重复操作 |

这个设计的精妙之处在于：它没有试图隐藏 CDP 的存在，而是**让网页的探测请求看起来像端口没开一样**。对网站来说，你的浏览器和一个普通用户的浏览器没有任何区别。

### 亮点 3：子 Agent Prompt 的用词陷阱

这是一个很容易被忽略但影响巨大的设计细节。

当你对 Agent 说"调研小红书上关于 Qwen 的风评"，主 Agent 会把任务分给子 Agent。问题在于，主 Agent 在自动生成子 Agent 的 Prompt 时，大概率会这样写：

> 在小红书上**搜索** Qwen 相关信息，总结近期风评

注意到了吗？你用的是"调研"，但主 Agent 随手写成了"搜索"。

**这一个词的差异，会导致完全不同的执行路径**：

```
用词"搜索" → 子 Agent 被 WebSearch 锚定 → 搜索引擎找不到小红书站内内容
                                    → 反复换关键词，一条道走到黑

用词"获取/调研" → 子 Agent 自主判断 → 发现小红书需要浏览器操作
                                 → 直接 CDP 打开小红书，站内搜索
                                 → 正确路径
```

这不是我臆想的场景。在 SKILL.md 中，作者专门有一段关于 Sub Agent 的事实说明，提醒模型在分治时注意用词对子 Agent 行为的影响。

这个洞察的本质是：**用词本身就是一种隐性规则，会限制 Agent 的判断空间**。设计 Skill 或 Prompt 时，不仅要考虑你直接对 Agent 说了什么，还要考虑 Agent 对自己的子 Agent 说了什么。

## 可迁移的洞察

研究完 Web Access，我提炼出几个可以迁移到其他 Agent Skill 设计中的思路：

**1. "技术事实"比"操作手册"更强大**

不说"遇到 A 就做 B"，而是说"A 有这样的特征，B 有那样的 tradeoff"。让模型理解原因，它就能处理你没预见过的场景。

**2. HTTP Proxy 是暴露复杂能力的通用模式**

Agent 只能执行 bash 命令，不能直接操作 WebSocket、数据库、GUI。HTTP Proxy 把这些复杂能力翻译成简单的 curl 调用。这个模式适用于任何需要给 Agent 暴露复杂能力的场景。

**3. 经验沉淀是 Agent 效率的关键分水岭**

同一个网站，第一次操作可能需要 20 步探索（找搜索框、试选择器、发现需要登录...）。有了经验后，3 步就能完成。按域名存储经验文件，下次直接读取，这是一种轻量但高效的 learning loop。

**4. 并发安全设计的简洁方案**

Pending Map 解决了异步并发匹配问题；每个 tab 独立 targetId + sessionId 解决了并行操作隔离问题；connectingPromise 防止并发连接。这些都是用最简洁的原语解决复杂问题的典范。

## 几个开放性问题

研究过程中，我也产生了一些没有标准答案的思考：

- **经验共享的法律边界**：如果所有用户把站点操作经验汇入一个共享池，效率会极高。但针对特定网站的结构化操作经验，是否会引起法务关注？
- **哲学式设计的可移植性**：Web Access 的"教 AI 怎么想"的方法，在多大程度上依赖于 Claude 的推理能力？换一个能力较弱的模型，效果会打几折？
- **安全性与便利性的平衡**：直连用户日常 Chrome 意味着 Agent 拥有你所有的登录态。便利性拉满，但安全边界在哪里？

## 最后

Web Access 证明了：一个设计精良的 Skill，不需要几万行代码、不需要训练模型、不需要预设每个网站的操作脚本——550 行代码 + 一套清晰的思考框架，就能让 AI Agent 获得像人一样的联网能力。

> 项目地址：[https://github.com/eze-is/web-access](https://github.com/eze-is/web-access)
> 安装命令：`npx skills add eze-is/web-access`

如果这篇文章对你有启发，去给项目点个 Star。
