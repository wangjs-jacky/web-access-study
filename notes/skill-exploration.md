---
article_id: OBA-m4k8r2t7
tags: [study-note, skill-exploration]
type: note
created_at: 2026-04-26
updated_at: 2026-04-26
---

# Skills 技能探索

## 这篇文章解决什么问题

你安装了 web-access skill，对着 Agent 说"帮我打开小红书"，Agent 就去执行了。但你不知道它背后调了哪个脚本、做了什么事、如果 Skill 层出问题能不能自己跑。

这篇文章的回答是：**可以。**

web-access 的底层脚本都是独立的 CLI 工具。Skill 层不稳定没关系，脚本本身是稳定的。下面把"用户说了什么"到"脚本做了什么"这条链路全部打通，每一步都可以直接复制命令验证。

## Prompt 速查表

你日常使用 web-access 时，说出的不同的话会触发不同的执行路径：

| 你会怎么说 | 背后触发什么 |
|---|---|
| "帮我搜索 XX" | WebSearch（Agent 内置搜索，不经过脚本） |
| "打开 XX 网站" / "访问 XX" | `check-deps.mjs` 检查环境 → `cdp-proxy.mjs` 启动 → curl 操控 Chrome |
| "看看这个网页的内容" | WebFetch / curl / Jina（Agent 内置，不需要浏览器） |
| "我之前看过的 XX" / "我们公司的系统" | `find-url.mjs` 搜索 Chrome 书签和历史 |
| "调研 A、B、C 多个目标" | 子 Agent 并行开 tab，各自调 CDP，共享 Proxy |
| （确定目标网站后，自动触发） | `match-site.mjs` 匹配已有站点经验 |

前两个（搜索、查看网页）是 Agent 内置能力，没有独立脚本。后面四个有对应的脚本或机制，是本文验证的重点。

## 环境准备

跑下面的测试之前，先确认环境就绪：

```bash
node ~/.claude/skills/web-access/scripts/check-deps.mjs
```

**预期输出**：

```
node: ok (v24.9.0)
chrome: ok (port 9222)
proxy: ready
```

三项全 ok/ready 即可继续。如果没通过，参考 [实战教程 Phase 1](web-access-how-to-use-guide.md) 完成环境配置。

---

## 验证 1："打开 XX 网站" → CDP 全流程

### 为什么是这个脚本

当你说"打开 XX 网站"，Agent 判断这个任务需要浏览器。它先跑 `check-deps.mjs` 确认 Node 和 Chrome 都就绪，自动启动 `cdp-proxy.mjs`（一个 HTTP 代理），然后通过 curl 命令操控 Chrome。

整个过程：**你说一句话 → Agent 跑脚本 → curl 控制 Chrome**。

### 验证步骤

CDP Proxy 本质是一个 HTTP 服务（端口 3456），把 curl 请求翻译成 Chrome 的 WebSocket 命令。我们直接用 curl 走一遍完整的 tab 生命周期：

**① 创建 tab**

```bash
curl -s "http://localhost:3456/new?url=https://example.com"
```

输出：`{"targetId":"..."}`，记下这个 ID，后续都用它。

**② 获取页面信息**

```bash
curl -s "http://localhost:3456/info?target=上面拿到的ID"
```

输出：`{"title":"Example Domain","url":"https://example.com/","ready":"complete"}`

**③ 执行 JavaScript**

```bash
curl -s -X POST "http://localhost:3456/eval?target=ID" -d 'document.title'
```

输出：`{"value":"Example Domain"}`

**④ 导航到另一个页面**

```bash
curl -s "http://localhost:3456/navigate?target=ID&url=https://httpbin.org/get"
```

导航后再 eval 看页面内容，会发现 User-Agent 是你真实 Chrome 的——说明是浏览器在发请求。

**⑤ 截图**

```bash
curl -s "http://localhost:3456/screenshot?target=ID&file=/tmp/shot.png"
```

**⑥ 关闭 tab**

```bash
curl -s "http://localhost:3456/close?target=ID"
```

输出：`{"success":true}`

### 一键验证脚本

把上面的流程拼成一个可以整体跑通的命令：

```bash
# 创建 tab 并捕获 targetId
T=$(curl -s "http://localhost:3456/new?url=https://example.com" | grep -o '"targetId":"[^"]*"' | cut -d'"' -f4)
echo "创建 tab: $T"

# 获取页面信息
echo "页面信息: $(curl -s "http://localhost:3456/info?target=$T")"

# 执行 JS
echo "页面标题: $(curl -s -X POST "http://localhost:3456/eval?target=$T" -d 'document.title')"

# 截图
echo "截图: $(curl -s "http://localhost:3456/screenshot?target=$T&file=/tmp/web-access-test.png")"

# 关闭
echo "关闭: $(curl -s "http://localhost:3456/close?target=$T")"
```

**实测输出**：

```
创建 tab: 747B2D5B1C5304C48ED4C5B416E12215
页面信息: {"title":"Example Domain","url":"https://example.com/","ready":"complete"}
页面标题: {"value":"Example Domain"}
截图: {"saved":"/tmp/web-access-test.png"}
关闭: {"success":true}
```

### 交互能力速查

除了"看"页面，CDP 还支持"操作"页面：

| 操作 | 命令 |
|------|------|
| 点击（JS 方式） | `curl -s -X POST "http://localhost:3456/click?target=ID" -d 'button.submit'` |
| 点击（真实鼠标） | `curl -s -X POST "http://localhost:3456/clickAt?target=ID" -d 'button.upload'` |
| 文件上传 | `curl -s -X POST "http://localhost:3456/setFiles?target=ID" -d '{"selector":"input[type=file]","files":["/path"]}'` |
| 滚动 | `curl -s "http://localhost:3456/scroll?target=ID&y=3000"` |
| 滚动到底 | `curl -s "http://localhost:3456/scroll?target=ID&direction=bottom"` |
| 后退 | `curl -s "http://localhost:3456/back?target=ID"` |
| 列出所有 tab | `curl -s http://localhost:3456/targets` |

---

## 验证 2："我之前看过的 XX" → find-url.mjs

### 为什么是这个脚本

SKILL.md 里写了一个明确的触发规则（第 73 行）：

> 用户指向本人访问过的页面（"我之前看的那个讲 X 的文章"）或组织内部系统（"我们的 XX 平台"）时，检索本地 Chrome 书签/历史。

这个场景搜索引擎帮不了你——它搜不到你的本地数据。所以 Agent 会调用 `find-url.mjs`，直接读取你 Chrome 本地的书签文件和历史 SQLite 数据库。

### 验证步骤

**① 搜索书签**

```bash
node ~/.claude/skills/web-access/scripts/find-url.mjs github --only bookmarks --limit 3
```

**实测输出**：

```
[书签] 3 条
  渲染引擎-Nunjucks | https://mozilla.github.io/nunjucks/cn/templating.html | 书签栏 / 携程
  index.ts — vscode-pair-diff [GitHub] | https://github.dev/antfu/vscode-pair-diff | 书签栏 / 携程
  VirMinions/MCP-Chinese-Getting-Started-Guide | https://github.com/... | 书签栏 / 携程
```

**② 搜索历史（最近 1 天）**

```bash
node ~/.claude/skills/web-access/scripts/find-url.mjs github --only history --since 1d --limit 3
```

**实测输出**：

```
[历史] 3 条（按最近访问）
  wangjs-jacky/web-access-study | https://github.com/wangjs-jacky/web-access-study | 2026-04-25 21:14:48
  jackwener/OpenCLI | https://github.com/jackwener/opencli | 2026-04-25 20:52:04 | visits=5
  Interactive Tutorial Framework - 视觉稿 | file:///Users/... | 2026-04-26 20:09:23
```

**③ 按访问次数排序（找高频网站）**

```bash
node ~/.claude/skills/web-access/scripts/find-url.mjs --only history --sort visits --limit 3
```

**实测输出**：

```
[历史] 3 条（按访问次数）
  Kimi AI 官网 - K2.6 上线 | https://www.kimi.com/ | 2026-04-23 15:09:56 | visits=535
  localhost:5387/#/addinformation | http://localhost:5387/... | 2026-04-23 20:00:43 | visits=436
  localhost:5387/#/?viewspotid=17481... | http://localhost:5387/... | 2026-04-23 20:00:00 | visits=399
```

**④ 多关键词 AND**

```bash
node ~/.claude/skills/web-access/scripts/find-url.mjs github react --limit 3
```

多关键词之间是 AND 关系——标题和 URL 必须同时包含两个词。

### find-url.mjs 参数速查

| 参数 | 说明 |
|------|------|
| `关键词` | 空格分词，多词 AND |
| `--only bookmarks` | 只搜书签 |
| `--only history` | 只搜历史 |
| `--since 1d` | 时间窗（d/h/m）或绝对日期 `2025-04-01` |
| `--sort visits` | 按访问次数排序 |
| `--limit N` | 结果数限制，默认 20 |

---

## 验证 3：站点经验匹配 → match-site.mjs

### 为什么是这个脚本

这个脚本比较特殊——**它没有对应的用户 prompt 词**。

SKILL.md 第 229 行的触发规则是：

> 确定目标网站后，如果前置检查输出的 site-patterns 列表中有匹配的站点，必须读取对应文件。

也就是说，当你说了"打开小红书"之后，Agent 判断出目标是 xiaohongshu.com，然后自动调用 `match-site.mjs` 看有没有之前积累的经验。整个过程对你透明。

这和 `find-url.mjs` 形成对比——`find-url.mjs` 有明确的触发词（"我之前看过的""我们公司的系统"），但 `match-site.mjs` 没有。

### 验证步骤

**① 创建测试经验文件**

```bash
mkdir -p ~/.claude/skills/web-access/references/site-patterns
cat > ~/.claude/skills/web-access/references/site-patterns/example.com.md << 'EOF'
---
domain: example.com
aliases: [示例网站, Example]
updated: 2026-04-26
---
## 平台特征
- 静态页面，无反爬
- 不需要登录

## 有效模式
- 直接访问 URL 即可获取内容

## 已知陷阱
- 无
EOF
```

**② domain 匹配**

```bash
node ~/.claude/skills/web-access/scripts/match-site.mjs "example.com"
```

**实测输出**：

```
--- 站点经验: example.com ---
## 平台特征
- 静态页面，无反爬
- 不需要登录

## 有效模式
- 直接访问 URL 即可获取内容

## 已知陷阱
- 无
```

**③ alias 匹配**

```bash
node ~/.claude/skills/web-access/scripts/match-site.mjs "示例网站"
```

输出同上——通过 aliases 字段匹配到了 example.com。

**④ 无匹配**

```bash
node ~/.claude/skills/web-access/scripts/match-site.mjs "不存在的网站xyz"
```

静默退出，exit code 0。不会报错，也不会输出任何内容。

**⑤ 清理**

```bash
rm ~/.claude/skills/web-access/references/site-patterns/example.com.md
```

---

## 验证 4："调研 A B C" → 并行分治

### 为什么没有脚本

"调研 A B C 多个目标"不会触发某个特定脚本。它的机制是：主 Agent 把任务分给多个子 Agent，每个子 Agent 各自调用 CDP（即验证 1 中的流程），通过不同的 targetId 操作不同的 tab，所有子 Agent 共享同一个 Chrome 和 Proxy。

这不是脚本能力，而是 Agent 的行为策略。

### 一个需要注意的设计细节

SKILL.md 里强调了一个很容易踩的坑——子 Agent prompt 的用词会影响执行路径：

| 主 Agent 写的 | 子 Agent 理解的 | 后果 |
|---|---|---|
| "搜索小红书上 XX" | 用 WebSearch | 搜索引擎找不到站内内容，反复重试 |
| "获取小红书上 XX" | 自主判断 | 直接 CDP 打开小红书，站内搜索 |

一个词的差别，导致完全不同的执行路径。"搜索"暗示用 WebSearch，"获取"让子 Agent 自主选择工具。这是 SKILL.md 精心设计的用词策略（第 198-200 行）。

---

## 缺口分析

上面验证了 6 个 prompt 路径，其中有 2 个存在设计缺口：

### 缺口 1：match-site.mjs 无用户 prompt 词

| 项 | 现状 |
|---|---|
| 脚本 | `match-site.mjs` ✅ 存在，可独立运行 |
| SKILL.md 说明 | 第 229 行：确定目标网站后自动读取 |
| 用户 prompt 词 | ❌ **没有** |
| 问题 | 用户无法主动说"看看 XX 站点之前积累的经验"；触发完全依赖 Agent 自主判断 |

对比 `find-url.mjs`：SKILL.md 明确写了触发词（"我之前看过的""我们公司的系统"），用户知道怎么说才能触发。但 `match-site.mjs` 没有这样的入口。

### 缺口 2：站点经验积累无脚本、无 prompt

| 项 | 现状 |
|---|---|
| 脚本 | ❌ **不存在** |
| SKILL.md 说明 | 第 231 行：CDP 操作成功后主动写入 `site-patterns/{domain}.md` |
| 实现方式 | Claude 直接写文件（纯 Agent 行为） |
| 问题 | 经验写入的格式、去重、更新策略完全依赖 Agent 自身能力，无脚本保障 |

---

## 速查表

### CDP Proxy API

```bash
curl -s http://localhost:3456/targets                          # 列出 tab
curl -s "http://localhost:3456/new?url=URL"                    # 创建 tab
curl -s "http://localhost:3456/info?target=ID"                 # 页面信息
curl -s -X POST "http://localhost:3456/eval?target=ID" -d 'JS' # 执行 JS
curl -s "http://localhost:3456/navigate?target=ID&url=URL"     # 导航
curl -s "http://localhost:3456/screenshot?target=ID&file=PATH" # 截图
curl -s "http://localhost:3456/close?target=ID"                # 关闭 tab
curl -s "http://localhost:3456/scroll?target=ID&y=3000"        # 滚动
curl -s "http://localhost:3456/click?target=ID" -d 'SELECTOR'  # 点击
curl -s "http://localhost:3456/back?target=ID"                 # 后退
curl -s http://localhost:3456/health                            # 健康检查
```

### 脚本命令

```bash
# 环境检查
node ~/.claude/skills/web-access/scripts/check-deps.mjs

# 搜索书签/历史
node ~/.claude/skills/web-access/scripts/find-url.mjs 关键词 --only bookmarks --limit 5
node ~/.claude/skills/web-access/scripts/find-url.mjs 关键词 --only history --since 1d
node ~/.claude/skills/web-access/scripts/find-url.mjs --only history --sort visits

# 站点经验匹配
node ~/.claude/skills/web-access/scripts/match-site.mjs "关键词"
```
